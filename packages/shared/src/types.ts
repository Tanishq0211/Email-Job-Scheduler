import { z } from "zod";
import { EMAIL_STATUSES } from "./index.js";

export const EmailAddressSchema = z.string().trim().toLowerCase().email();

export const ScheduleRequestSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(100_000),
  senderId: z.string().uuid(),
  startTime: z.coerce.date(),
  delayBetweenEmailsMs: z.number().int().min(0).max(3_600_000),
  hourlyLimit: z.number().int().min(1).max(100_000),
  // Recipients are strings here; strict validation + invalid-reporting
  // happens in sanitizeRecipients so bad rows are reported, not rejected.
  recipients: z.array(z.string().trim().min(3).max(254)).min(1),
});
export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;

export interface ScheduleResponse {
  scheduledCount: number;
  duplicatesRemoved: number;
  invalidRecipients: string[];
  startTime: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface ApiEmail {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: (typeof EMAIL_STATUSES)[number];
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  attempts: number;
  lastError: string | null;
  messageId: string | null;
  senderEmail: string | null;
  senderDisplayName: string | null;
  createdAt: string;
}

export interface ApiSender {
  id: string;
  email: string;
  displayName: string;
  hourlyLimit: number;
  minDelayMs: number;
  createdAt: string;
}

export interface ApiSlackStatus {
  connected: boolean;
  teamName: string | null;
  channelId: string | null;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string; details?: unknown };
}
