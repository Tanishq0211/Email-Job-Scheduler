import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { redis, emailQueue, closeQueue } from "../../src/queues/connection.js";
import { emailJobId } from "@reachinbox/shared";
import { scheduleCampaign } from "../../src/services/scheduler/scheduler.service.js";
import { servicesUp, cleanDatabase, teardown } from "../helpers/services.js";

/**
 * §19/§48: 1000+ recipients must become 1000 DB rows + 1000 individual
 * BullMQ jobs, with no duplicate job ids, without blowing memory or
 * leaving the queue inconsistent.
 */
let userId: string;
let senderId: string;

beforeAll(async () => {
  if (!(await servicesUp())) return;
  if (redis.status !== "ready") await redis.connect();
  await cleanDatabase();

  const user = await prisma.user.create({
    data: {
      googleId: `google-${crypto.randomUUID()}`,
      email: `bulk-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: "Bulk Test",
    },
  });
  userId = user.id;
  senderId = (
    await prisma.sender.create({
      data: { userId: user.id, email: "bulk@example.com", displayName: "Bulk" },
    })
  ).id;
});

afterAll(async () => {
  await teardown();
});

describe.skipIf(!(await servicesUp()))("1000-recipient campaign", () => {
  it(
    "creates 1000 rows and 1000 uniquely-identified delayed jobs",
    { timeout: 120_000 },
    async () => {
      const recipients = Array.from({ length: 1000 }, (_, i) => `bulk${i}@example.com`);
      recipients[500] = "BULK100@Example.com"; // duplicate of index 100

      const start = Date.now();
      const result = await scheduleCampaign({
        userId,
        senderId,
        senderHourlyLimit: 200,
        subject: "Bulk campaign",
        body: "1000 recipients",
        startTime: new Date(Date.now() + 60_000),
        delayBetweenEmailsMs: 50, // test env min
        hourlyLimit: 100, // below sender cap → must win
        recipients,
      });
      const elapsed = Date.now() - start;

      expect(result.scheduledCount).toBe(999);
      expect(result.duplicatesRemoved).toBe(1);
      expect(elapsed).toBeLessThan(60_000);

      const rows = await prisma.email.findMany({
        where: { userId },
        select: { id: true, hourlyLimit: true, bullJobId: true },
      });
      expect(rows).toHaveLength(999);

      // Every row carries the campaign (tightened) hourly limit and a
      // deterministic bullJobId that matches its job id.
      expect(rows.every((r) => r.hourlyLimit === 100)).toBe(true);
      expect(
        rows.every((r) => r.bullJobId === emailJobId(r.id)),
      ).toBe(true);
      expect(new Set(rows.map((r) => r.bullJobId)).size).toBe(999);

      // All 999 jobs exist in the queue as delayed/waiting.
      const jobs = await emailQueue.getJobs(["delayed", "waiting"], 0, 2000);
      const jobIds = new Set(jobs.map((j) => j.id));
      expect(rows.every((r) => jobIds.has(emailJobId(r.id)))).toBe(true);

      // Cleanup so other suites start from an empty queue.
      for (const r of rows) {
        const job = await emailQueue.getJob(emailJobId(r.id));
        if (job) await job.remove().catch(() => {});
      }
      await prisma.email.deleteMany({ where: { userId } });
    },
  );
});
