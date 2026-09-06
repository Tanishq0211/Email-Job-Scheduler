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
      if (email.status !== "scheduled" && email.status !== "processing") {
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

      const slot = await acquireSendSlot(
        redis,
        email.senderId,
        email.sender.hourlyLimit,
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
            hourlyLimit: email.sender.hourlyLimit,
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
