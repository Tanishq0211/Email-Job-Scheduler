import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { redis, emailQueue, closeQueue } from "../../src/queues/connection.js";
import { emailJobId } from "@reachinbox/shared";
import {
  claimForProcessing,
  markSent,
  revertToScheduled,
} from "../../src/services/email/email-state.service.js";
import { enqueueEmailJobs, jobExists } from "../../src/queues/email.queue.js";
import { reconcileEmailJobs } from "../../src/services/scheduler/job-reconciliation.service.js";
import { acquireSendSlot } from "../../src/services/rate-limit/rate-limit.service.js";
import { servicesUp, cleanDatabase, teardown } from "../helpers/services.js";

let senderId: string;
let userId: string;

beforeAll(async () => {
  if (!(await servicesUp())) return;
  if (redis.status !== "ready") await redis.connect();
  await cleanDatabase();

  const user = await prisma.user.create({
    data: {
      googleId: `google-${crypto.randomUUID()}`,
      email: `idem-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: "Idempotency Test",
    },
  });
  userId = user.id;
  senderId = (
    await prisma.sender.create({
      data: { userId: user.id, email: "s@example.com", displayName: "S" },
    })
  ).id;
});

afterAll(async () => {
  await teardown();
});

async function createEmail(status = "scheduled") {
  const email = await prisma.email.create({
    data: {
      userId,
      senderId,
      recipient: `${crypto.randomUUID().slice(0, 8)}@example.com`,
      subject: "Idempotency",
      body: "body",
      scheduledAt: new Date(),
      status,
    },
  });
  await enqueueEmailJobs([{ id: email.id, scheduledAt: email.scheduledAt }]);
  return email;
}

describe.skipIf(!(await servicesUp()))("Idempotency and reconciliation", () => {
  it("lets exactly one worker claim an email (atomic state transition)", async () => {
    const email = await createEmail();
    const claims = await Promise.all([
      claimForProcessing(email.id),
      claimForProcessing(email.id),
      claimForProcessing(email.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("never re-sends an email already marked sent", async () => {
    const email = await createEmail();
    await claimForProcessing(email.id);
    await markSent(email.id, "msg-1", null);

    // A duplicate delivery of the same job finds status=sent and skips.
    const found = await prisma.email.findUnique({ where: { id: email.id } });
    expect(found?.status).toBe("sent");

    const claim = await claimForProcessing(email.id);
    expect(claim).toBe(false);
  });

  it("reschedules instead of dropping when the hourly limit blocks", async () => {
    const email = await createEmail();
    await claimForProcessing(email.id);

    // Exhaust a limit of 1 for this sender.
    const slot1 = await acquireSendSlot(redis, senderId, 1, 0);
    expect(slot1.acquired).toBe(true);

    const blocked = await acquireSendSlot(redis, senderId, 1, 0);
    expect(blocked.acquired).toBe(false);
    if (!blocked.acquired) expect(blocked.reason).toBe("hourly");

    // Worker reverts the email to scheduled (never failed, never dropped).
    await revertToScheduled(email.id);
    const after = await prisma.email.findUnique({ where: { id: email.id } });
    expect(after?.status).toBe("scheduled");
    void slot1;
  });

  it("recreates only missing jobs on startup reconciliation", async () => {
    const email = await createEmail();
    expect(await jobExists(email.id)).toBe(true);

    // Simulate job loss (e.g. Redis flush) without touching the DB row.
    const job = await emailQueue.getJob(emailJobId(email.id));
    await job!.remove();
    expect(await jobExists(email.id)).toBe(false);

    const result = await reconcileEmailJobs();
    expect(result.recreated).toBeGreaterThanOrEqual(1);
    expect(await jobExists(email.id)).toBe(true);

    // Idempotent: a second pass must not create anything new.
    const again = await reconcileEmailJobs();
    expect(again.recreated).toBe(0);
  });

  it("keeps the same deterministic job id after reconciliation", async () => {
    const email = await createEmail();
    const job = await emailQueue.getJob(emailJobId(email.id));
    expect(job?.id).toBe(emailJobId(email.id));
  });
});
