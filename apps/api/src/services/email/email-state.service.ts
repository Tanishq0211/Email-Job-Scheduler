import { prisma } from "../../db/prisma.js";
import { childLogger } from "../../utils/logger.js";
import { EMAIL_STATUSES, type EmailStatus } from "@reachinbox/shared";

const log = childLogger({ operation: "email.state" });

/**
 * State machine (PostgreSQL is the source of truth):
 *   scheduled → processing (atomic claim; exactly one worker wins)
 *   processing → sent | failed
 *   processing → scheduled (rate-limit reschedule or retryable failure)
 */

/** Atomically claim a scheduled email for processing. Returns false if
 * another worker already claimed it or it is no longer scheduled. */
export async function claimForProcessing(emailId: string): Promise<boolean> {
  const result = await prisma.email.updateMany({
    where: { id: emailId, status: "scheduled" },
    data: { status: "processing" },
  });
  return result.count === 1;
}

/** processing → sent (only if still processing). */
export async function markSent(
  emailId: string,
  messageId: string,
  previewUrl: string | null,
): Promise<boolean> {
  const result = await prisma.email.updateMany({
    where: { id: emailId, status: "processing" },
    data: { status: "sent", sentAt: new Date(), messageId, previewUrl },
  });
  return result.count === 1;
}

/** processing → failed, storing a user-safe error message. */
export async function markFailed(emailId: string, lastError: string): Promise<void> {
  await prisma.email.updateMany({
    where: { id: emailId, status: "processing" },
    data: {
      status: "failed",
      failedAt: new Date(),
      lastError: lastError.slice(0, 1000),
    },
  });
  log.info({ emailId }, "email failed");
}

/** processing → scheduled, without counting it as an SMTP attempt. */
export async function revertToScheduled(emailId: string): Promise<void> {
  await prisma.email.updateMany({
    where: { id: emailId, status: "processing" },
    data: { status: "scheduled" },
  });
}

/** Increment the attempt counter (SMTP attempts only, never rate-limit waits). */
export async function incrementAttempts(emailId: string): Promise<void> {
  await prisma.email.update({
    where: { id: emailId },
    data: { attempts: { increment: 1 } },
  });
}

export async function getEmailById(id: string, userId: string) {
  const email = await prisma.email.findFirst({
    where: { id, userId },
    include: { sender: { select: { email: true, displayName: true } } },
  });
  return email;
}

export function isEmailStatus(value: string): value is EmailStatus {
  return (EMAIL_STATUSES as readonly string[]).includes(value);
}
