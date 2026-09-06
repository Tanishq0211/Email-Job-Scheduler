import type { Email } from "@prisma/client";
import { emailJobId, SEND_EMAIL_JOB_NAME } from "@reachinbox/shared";
import { emailQueue } from "./connection.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ operation: "email.queue" });

export interface QueuedEmail {
  id: string;
  scheduledAt: Date;
}

/**
 * Enqueue one BullMQ delayed job per email with a deterministic jobId
 * (`email:<emailId>`). The deterministic ID makes re-enqueueing an
 * idempotent no-op while the job still exists, which is what keeps
 * startup reconciliation safe.
 */
export async function enqueueEmailJobs(
  emails: QueuedEmail[],
): Promise<void> {
  const now = Date.now();
  const jobs = emails.map((email) => ({
    name: SEND_EMAIL_JOB_NAME,
    data: { emailId: email.id },
    opts: {
      jobId: emailJobId(email.id),
      delay: Math.max(0, email.scheduledAt.getTime() - now),
    },
  }));
  await emailQueue.addBulk(jobs);
  log.info({ count: jobs.length }, "delayed jobs enqueued");
}

export async function jobExists(emailId: string): Promise<boolean> {
  const job = await emailQueue.getJob(emailJobId(emailId));
  if (!job) return false;
  const state = await job.getState();
  // completed/failed jobs no longer exist for scheduling purposes
  return state !== "completed" && state !== "failed";
}

export type { Email };
