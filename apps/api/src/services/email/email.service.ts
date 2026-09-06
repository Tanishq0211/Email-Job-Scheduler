import type { Email } from "@prisma/client";
import type { Paginated, ApiEmail, EmailStatus } from "@reachinbox/shared";
import { prisma } from "../../db/prisma.js";

export function toApiEmail(email: Email & {
  sender?: { email: string; displayName: string } | null;
}): ApiEmail {
  return {
    id: email.id,
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    status: email.status as EmailStatus,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    failedAt: email.failedAt?.toISOString() ?? null,
    attempts: email.attempts,
    lastError: email.lastError,
    messageId: email.messageId,
    senderEmail: email.sender?.email ?? null,
    senderDisplayName: email.sender?.displayName ?? null,
    createdAt: email.createdAt.toISOString(),
  };
}

export async function listEmails(
  userId: string,
  params: {
    statuses: string[];
    page: number;
    pageSize: number;
    search?: string;
  },
): Promise<Paginated<ApiEmail>> {
  const where = {
    userId,
    status: { in: params.statuses },
    ...(params.search
      ? {
          OR: [
            { recipient: { contains: params.search, mode: "insensitive" as const } },
            { subject: { contains: params.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, emails] = await Promise.all([
    prisma.email.count({ where }),
    prisma.email.findMany({
      where,
      include: { sender: { select: { email: true, displayName: true } } },
      orderBy: { scheduledAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    items: emails.map(toApiEmail),
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
