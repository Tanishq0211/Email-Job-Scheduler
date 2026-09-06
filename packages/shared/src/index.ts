export * from "./types.js";

export const EMAIL_STATUSES = [
  "scheduled",
  "processing",
  "sent",
  "failed",
  "cancelled",
] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const QUEUE_NAME = "email-queue";
export const SEND_EMAIL_JOB_NAME = "send-email";

// BullMQ forbids ":" in custom job ids, so the deterministic id is
// "email_<emailId>".
export const EMAIL_JOB_ID_PREFIX = "email_";

export function emailJobId(emailId: string): string {
  return `${EMAIL_JOB_ID_PREFIX}${emailId}`;
}

/** UTC hour window identifier, e.g. "2026-09-06-18". */
export function utcHourWindow(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13).replace("T", "-");
}

export function rateLimitKey(senderId: string, window: string): string {
  return `email-rate:${senderId}:${window}`;
}

export function sendGateKey(senderId: string): string {
  return `email-send-gate:${senderId}`;
}

export function slackAlertKey(senderId: string, window: string): string {
  return `slack-rate-alert:${senderId}:${window}`;
}
