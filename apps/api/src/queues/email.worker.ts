import { Worker, DelayedError, type Job } from "bullmq";
import { config } from "../config/env.js";
import { createQueueConnection, redis } from "./connection.js";
import { childLogger } from "../utils/logger.js";
import {
  claimForProcessing,
  markSent,
  markFailed,
  revertToScheduled,
  incrementAttempts,
  recoverStuckProcessing,
} from "../services/email/email-state.service.js";
import {
  acquireSendSlot,
  releaseSendSlot,
} from "../services/rate-limit/rate-limit.service.js";
import { sendEmail } from "../services/email/smtp.service.js";
import { indexEmail } from "../services/elasticsearch/elasticsearch.service.js";
import { notifyRateLimitReached } from "../services/slack/slack.notification.service.js";
import { prisma } from "../db/prisma.js";

const log = childLogger({ operation: "email.worker" });

/** Claims older than this are considered abandoned by a crashed worker
 * (BullMQ re-delivers stalled jobs ~30s after the lock expires). */
const STALE_CLAIM_MS = 20_000;

/**
 * Email send worker.
 *
 * Guarantees:
 *  - Idempotency: an email is sent only after an atomic DB claim
 *    (scheduled → processing); a job whose email is already sent/claimed
 *    returns without sending. Duplicate job delivery can never double-send.
 *  - Distributed throttling: the hourly counter and the min-delay gate
 *    are enforced atomically in Redis, so any number of workers respect
 *    the same limits.
 *  - Rate-limit handling: blocked jobs are moved back to delayed
 *    (next UTC hour for the hourly cap, remaining wait for the min
 *    delay) without consuming an attempt and without losing the email.
 */
export function startEmailWorker() {
  const worker = new Worker(
    "email-queue",
    async (job: Job<{ emailId: string }>) => {
      const token = job.token;
      const { emailId } = job.data;
      const jobLog = log.child({ jobId: job.id, emailId });

      const email = await prisma.email.findUnique({
        where: { id: emailId },
        include: { sender: true },
      });

      if (!email) {
        jobLog.warn("email row missing; nothing to do");
        return;
      }
      if (email.status === "sent") {
        jobLog.info("email already sent; skipping duplicate processing");
        return;
      }

      if (email.status === "processing") {
        // This job was re-delivered after a worker crash mid-send. If the
        // previous claim is stale, hand the email back to `scheduled` so
        // the atomic claim below can succeed; if it is fresh, another
        // worker holds it and we exit safely.
        const recovered = await recoverStuckProcessing(
          emailId,
          email.updatedAt,
          STALE_CLAIM_MS,
        );
        if (!recovered) {
          jobLog.info("email actively processing elsewhere; skipping");
          return;
        }
        email.status = "scheduled";
      }

      if (email.status !== "scheduled") {
        jobLog.info({ status: email.status }, "email not sendable; skipping");
        return;
      }

      // Atomic claim: exactly one worker may proceed.
      const claimed = await claimForProcessing(emailId);
      if (!claimed) {
        jobLog.info("claim lost to another worker; skipping");
        return;
      }
      jobLog.info("job claimed");

      // Effective hourly cap: a campaign's requested limit may tighten the
      // sender's configured safety cap but never exceed it. The shared
      // per-sender Redis counter makes the most restrictive limit win.
      const hourlyLimit = Math.min(
        email.sender.hourlyLimit,
        email.hourlyLimit ?? email.sender.hourlyLimit,
      );

      const slot = await acquireSendSlot(
        redis,
        email.senderId,
        hourlyLimit,
        email.sender.minDelayMs,
      );

      if (!slot.acquired) {
        // Not an SMTP attempt: revert status, keep the email scheduled.
        await revertToScheduled(emailId);

        if (slot.reason === "hourly") {
          jobLog.info(
            { window: slot.window, retryInMs: slot.retryInMs },
            "hourly rate limit reached; rescheduling to next window",
          );
          void notifyRateLimitReached(redis, {
            userId: email.userId,
            senderId: email.senderId,
            senderEmail: email.sender.email,
            hourlyLimit,
          });
        } else {
          jobLog.info(
            { retryInMs: slot.retryInMs },
            "min send delay not elapsed; deferring",
          );
        }

        await job.moveToDelayed(Date.now() + slot.retryInMs, token);
        throw new DelayedError();
      }

      try {
        const result = await sendEmail({
          fromAddress: email.sender.email,
          fromName: email.sender.displayName,
          to: email.recipient,
          subject: email.subject,
          body: email.body,
          // Deterministic Message-ID: if the process dies after the SMTP
          // server accepted the message but before the DB commit, a retry
          // re-sends the same Message-ID, which receiving servers treat as
          // the same message. (Best practical guarantee — see README.)
          deterministicId: email.id,
        });

        const marked = await markSent(
          emailId,
          result.messageId,
          result.previewUrl,
        );
        if (marked) {
          jobLog.info({ messageId: result.messageId }, "email sent");
          const updated = await prisma.email.findUnique({
            where: { id: emailId },
          });
          if (updated) void indexEmail(updated);
        }
      } catch (err) {
        await releaseSendSlot(redis, email.senderId, slot.window);
        await incrementAttempts(emailId);

        const attemptsAllowed = job.opts.attempts ?? 1;
        const isFinalAttempt = job.attemptsMade + 1 >= attemptsAllowed;

        if (isFinalAttempt) {
          const message = err instanceof Error ? err.message : "SMTP failure";
          await markFailed(emailId, message);
          jobLog.error({ err }, "email permanently failed");
          throw err; // BullMQ records the final failure
        }

        // Transient SMTP error: revert so the retry can re-claim.
        await revertToScheduled(emailId);
        jobLog.warn(
          { err, attempt: job.attemptsMade + 1 },
          "transient send failure; will retry",
        );
        throw err;
      }
    },
    {
      connection: createQueueConnection(),
      concurrency: config.workerConcurrency,
    },
  );

  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, err: err.message },
      "job failed event",
    );
  });

  worker.on("error", (err) => {
    log.error({ err }, "worker error");
  });

  log.info(
    { concurrency: config.workerConcurrency },
    "worker started",
  );

  return worker;
}
