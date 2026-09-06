import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { redis, closeQueue } from "../../src/queues/connection.js";
import { startEmailWorker } from "../../src/queues/email.worker.js";
import { enqueueEmailJobs } from "../../src/queues/email.queue.js";
import { searchEmails } from "../../src/services/elasticsearch/elasticsearch.service.js";
import { notifyRateLimitReached } from "../../src/services/slack/slack.notification.service.js";
import { servicesUp, cleanDatabase, teardown } from "../helpers/services.js";
import type { Worker } from "bullmq";

/**
 * End-to-end happy path:
 *   email row → BullMQ delayed job → worker → SMTP (Ethereal) →
 *   DB = sent → Elasticsearch indexed.
 *
 * Uses the real Ethereal credentials from SMTP_USER/SMTP_PASSWORD.
 * Runs only when services + SMTP credentials are available.
 */
let worker: Worker;
let userId: string;
let senderId: string;

const hasSmtp = Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);

beforeAll(async () => {
  if (!(await servicesUp()) || !hasSmtp) return;
  if (redis.status !== "ready") await redis.connect();
  await cleanDatabase();

  const { ensureEmailIndex } = await import(
    "../../src/services/elasticsearch/elasticsearch.service.js"
  );
  await ensureEmailIndex();

  const user = await prisma.user.create({
    data: {
      googleId: `google-${crypto.randomUUID()}`,
      email: `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: "E2E Test",
    },
  });
  userId = user.id;
  senderId = (
    await prisma.sender.create({
      data: { userId: user.id, email: process.env.SMTP_USER!, displayName: "E2E Sender" },
    })
  ).id;

  worker = startEmailWorker();
});

afterAll(async () => {
  if (worker) await worker.close();
  await teardown();
});

describe.skipIf(!(await servicesUp()) || !hasSmtp)("End-to-end email flow", () => {
  it(
    "sends immediately-scheduled emails via SMTP and indexes them in Elasticsearch",
    { timeout: 60_000 },
    async () => {
      const recipient = `e2e-recipient-${crypto.randomUUID().slice(0, 8)}@example.com`;
      const email = await prisma.email.create({
        data: {
          userId,
          senderId,
          recipient,
          subject: `E2E send test ${crypto.randomUUID().slice(0, 8)}`,
          body: "Hello from the end-to-end test",
          scheduledAt: new Date(),
        },
      });
      await enqueueEmailJobs([{ id: email.id, scheduledAt: email.scheduledAt }]);

      // Poll PostgreSQL (source of truth) until the worker marks it sent.
      let row = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
      for (let i = 0; i < 40 && row.status !== "sent"; i++) {
        await new Promise((r) => setTimeout(r, 500));
        row = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
      }
      expect(row.status).toBe("sent");
      expect(row.messageId).toBeTruthy();

      // Elasticsearch projection is eventually consistent.
      let indexed = false;
      for (let i = 0; i < 20 && !indexed; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const result = await searchEmails({ userId, q: recipient, page: 1, pageSize: 10 });
        indexed = result.items.some((hit) => hit.id === email.id);
      }
      expect(indexed).toBe(true);
    },
  );

  it("continues processing when rate limit is hit without a Slack connection", async () => {
    // No Slack connection exists for userId — notification must be a no-op.
    await expect(
      notifyRateLimitReached(redis, {
        userId,
        senderId,
        senderEmail: "no-slack@example.com",
        hourlyLimit: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
