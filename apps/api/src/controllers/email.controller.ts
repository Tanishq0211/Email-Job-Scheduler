import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { scheduleCampaign } from "../services/scheduler/scheduler.service.js";
import { listEmails, toApiEmail } from "../services/email/email.service.js";
import { searchEmails } from "../services/elasticsearch/elasticsearch.service.js";
import { NotFoundError } from "../utils/errors.js";
import { config } from "../config/env.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

const searchQuerySchema = listQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(30).optional(),
  senderId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

/** POST /api/emails/schedule */
export async function scheduleEmails(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = req.body as {
    senderId: string;
    subject: string;
    body: string;
    startTime: Date;
    delayBetweenEmailsMs: number;
    hourlyLimit: number;
    recipients: string[];
  };

  const sender = await prisma.sender.findFirst({
    where: { id: body.senderId, userId: user.id },
  });
  if (!sender) throw new NotFoundError("Sender not found");

  const result = await scheduleCampaign({
    userId: user.id,
    senderId: sender.id,
    senderHourlyLimit: sender.hourlyLimit,
    subject: body.subject,
    body: body.body,
    startTime: body.startTime,
    delayBetweenEmailsMs: body.delayBetweenEmailsMs,
    hourlyLimit: body.hourlyLimit,
    recipients: body.recipients,
  });

  res.status(201).json({ success: true, data: result });
}

/** GET /api/emails/scheduled */
export async function listScheduled(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  const result = await listEmails(user.id, {
    statuses: ["scheduled", "processing"],
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
  });
  res.json({ success: true, data: result });
}

/** GET /api/emails/sent (includes failed; filter with ?status=) */
export async function listSent(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const query = req.query as unknown as z.infer<typeof listQuerySchema> & {
    status?: string;
  };
  const statuses =
    query.status === "sent" || query.status === "failed"
      ? [query.status]
      : ["sent", "failed"];
  const result = await listEmails(user.id, {
    statuses,
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
  });
  res.json({ success: true, data: result });
}

/** GET /api/emails/:id */
export async function getEmail(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { id } = req.params as { id: string };
  const email = await prisma.email.findFirst({
    where: { id, userId: user.id },
    include: { sender: { select: { email: true, displayName: true } } },
  });
  if (!email) throw new NotFoundError("Email not found");
  res.json({
    success: true,
    data: {
      email: {
        ...toApiEmail(email),
        body: email.body,
        previewUrl: email.previewUrl,
      },
    },
  });
}

/** GET /api/emails/search?q=... — Elasticsearch-backed search. */
export async function search(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const query = req.query as unknown as z.infer<typeof searchQuerySchema>;

  const result = await searchEmails({
    userId: user.id,
    q: query.q,
    status: query.status,
    senderId: query.senderId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    success: true,
    data: {
      items: result.items,
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      index: config.elasticsearchIndex,
    },
  });
}

export { listQuerySchema, searchQuerySchema };
