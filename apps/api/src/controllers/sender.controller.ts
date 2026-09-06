import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { config } from "../config/env.js";
import { NotFoundError } from "../utils/errors.js";

const createSenderSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(1).max(100),
  hourlyLimit: z.number().int().min(1).max(100_000).optional(),
  minDelayMs: z.number().int().min(0).max(3_600_000).optional(),
});

const updateSenderSchema = createSenderSchema.partial().extend({
  email: z.string().trim().toLowerCase().email().optional(),
});

/** GET /api/senders */
export async function listSenders(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const senders = await prisma.sender.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  res.json({ success: true, data: { senders } });
}

/** POST /api/senders */
export async function createSender(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = req.body as z.infer<typeof createSenderSchema>;

  const existing = await prisma.sender.findFirst({
    where: { userId: user.id, email: body.email },
  });
  if (existing) {
    res.json({ success: true, data: { sender: existing } });
    return;
  }

  const sender = await prisma.sender.create({
    data: {
      userId: user.id,
      email: body.email,
      displayName: body.displayName,
      hourlyLimit: body.hourlyLimit ?? config.maxEmailsPerHour,
      minDelayMs: body.minDelayMs ?? config.minSendDelayMs,
    },
  });
  res.status(201).json({ success: true, data: { sender } });
}

/** PATCH /api/senders/:id */
export async function updateSender(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = req.body as z.infer<typeof updateSenderSchema>;
  const { id } = req.params as { id: string };

  const existing = await prisma.sender.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) throw new NotFoundError("Sender not found");

  const sender = await prisma.sender.update({
    where: { id: existing.id },
    data: {
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.hourlyLimit !== undefined ? { hourlyLimit: body.hourlyLimit } : {}),
      ...(body.minDelayMs !== undefined ? { minDelayMs: body.minDelayMs } : {}),
    },
  });
  res.json({ success: true, data: { sender } });
}
