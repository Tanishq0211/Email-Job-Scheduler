import crypto from "node:crypto";
import {
  ScheduleRequestSchema,
  emailJobId,
} from "@reachinbox/shared";
import { prisma } from "../../db/prisma.js";
import { enqueueEmailJobs } from "../../queues/email.queue.js";
import { computeScheduleTimes } from "../../utils/dates.js";
import { sanitizeRecipients } from "../../utils/email-parser.js";
import { ValidationError } from "../../utils/errors.js";
import { childLogger } from "../../utils/logger.js";
import { config } from "../../config/env.js";
import { indexEmail } from "../elasticsearch/elasticsearch.service.js";

const log = childLogger({ operation: "scheduler" });

export interface ScheduleCampaignInput {
  userId: string;
  senderId: string;
  senderHourlyLimit: number;
  subject: string;
  body: string;
  startTime: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  recipients: string[];
}

export interface ScheduleCampaignResult {
  scheduledCount: number;
  duplicatesRemoved: number;
  invalidRecipients: string[];
  startTime: string;
}

/**
 * Persist one Email row per recipient and enqueue one deterministic
 * BullMQ delayed job per email, staggered by the requested delay.
 *
 * Ordering: DB rows are created first (source of truth), then jobs.
 * If job enqueueing fails the rows remain `scheduled` and startup
 * reconciliation recreates the missing jobs via deterministic IDs.
 */
export async function scheduleCampaign(
  input: ScheduleCampaignInput,
): Promise<ScheduleCampaignResult> {
  if (input.delayBetweenEmailsMs < config.minSendDelayMs) {
    throw new ValidationError(
      `Delay between emails must be at least ${config.minSendDelayMs}ms`,
    );
  }
  if (input.recipients.length > config.maxRecipientsPerRequest) {
    throw new ValidationError(
      `At most ${config.maxRecipientsPerRequest} recipients per request`,
    );
  }

  const { valid, invalid, duplicatesRemoved } = sanitizeRecipients(
    input.recipients,
  );
  if (valid.length === 0) {
    throw new ValidationError("No valid recipients provided", { invalid });
  }

  const sendTimes = computeScheduleTimes(
    input.startTime,
    input.delayBetweenEmailsMs,
    valid.length,
  );

  const rows = valid.map((recipient, i) => ({
    id: crypto.randomUUID(),
    userId: input.userId,
    senderId: input.senderId,
    recipient,
    subject: input.subject,
    body: input.body,
    scheduledAt: sendTimes[i],
    status: "scheduled" as const,
    bullJobId: "", // set below from the deterministic id
  }));
  for (const row of rows) row.bullJobId = emailJobId(row.id);

  await prisma.email.createMany({ data: rows });

  await enqueueEmailJobs(
    rows.map((r) => ({ id: r.id, scheduledAt: r.scheduledAt })),
  );

  // Best-effort search projection — never fails the schedule request.
  void (async () => {
    const created = await prisma.email.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    for (const email of created) await indexEmail(email);
  })().catch((err) => log.error({ err }, "post-schedule indexing failed"));

  log.info(
    {
      userId: input.userId,
      senderId: input.senderId,
      scheduledCount: rows.length,
      invalid: invalid.length,
      duplicatesRemoved,
    },
    "campaign scheduled",
  );

  return {
    scheduledCount: rows.length,
    duplicatesRemoved,
    invalidRecipients: invalid,
    startTime: sendTimes[0].toISOString(),
  };
}

/** Parse + validate a schedule request body (shared by controller/tests). */
export function parseScheduleRequest(payload: unknown) {
  return ScheduleRequestSchema.parse(payload);
}
