import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { redis, emailQueue, closeQueue } from "../../src/queues/connection.js";
import { emailJobId } from "@reachinbox/shared";
import { createSession } from "../../src/services/auth/session.service.js";
import { servicesUp, cleanDatabase, teardown } from "../helpers/services.js";
import type { Express } from "express";

let app: Express;
let cookie: string;
let user: { id: string };
let sender: { id: string };

beforeAll(async () => {
  if (!(await servicesUp())) return;

  const { ensureEmailIndex } = await import(
    "../../src/services/elasticsearch/elasticsearch.service.js"
  );
  await ensureEmailIndex();
  await cleanDatabase();

  app = createApp();
  user = await prisma.user.create({
    data: {
      googleId: `google-${crypto.randomUUID()}`,
      email: `owner-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: "Test Owner",
    },
  });
  sender = await prisma.sender.create({
    data: {
      userId: user.id,
      email: "sender@example.com",
      displayName: "Test Sender",
      hourlyLimit: 10,
      minDelayMs: 50,
    },
  });
  const session = await createSession(user.id);
  cookie = `reachinbox_session=${session.token}`;
});

afterAll(async () => {
  await teardown();
});

describe.skipIf(!(await servicesUp()))("Schedule API (integration)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/emails/scheduled");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects scheduling for a sender the user does not own", async () => {
    const otherUser = await prisma.user.create({
      data: {
        googleId: `google-${crypto.randomUUID()}`,
        email: `other-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: "Other",
      },
    });
    const otherSender = await prisma.sender.create({
      data: { userId: otherUser.id, email: "x@y.com", displayName: "X" },
    });

    const res = await request(app)
      .post("/api/emails/schedule")
      .set("Cookie", cookie)
      .send({
        subject: "hi",
        body: "world",
        senderId: otherSender.id,
        startTime: new Date().toISOString(),
        delayBetweenEmailsMs: 100,
        hourlyLimit: 5,
        recipients: ["a@example.com"],
      });
    expect(res.status).toBe(404);
  });

  it("rejects invalid payloads with a validation error", async () => {
    const res = await request(app)
      .post("/api/emails/schedule")
      .set("Cookie", cookie)
      .send({ subject: "", recipients: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("schedules emails, persists rows, and creates delayed jobs", async () => {
    const future = new Date(Date.now() + 60_000);
    const res = await request(app)
      .post("/api/emails/schedule")
      .set("Cookie", cookie)
      .send({
        subject: "Test campaign",
        body: "Hello from the integration test",
        senderId: sender.id,
        startTime: future.toISOString(),
        delayBetweenEmailsMs: 100,
        hourlyLimit: 5,
        recipients: [
          "a@example.com",
          "b@example.com",
          "a@example.com", // duplicate must be removed server-side
          "not-an-email", // invalid must be rejected server-side
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.scheduledCount).toBe(2);
    expect(res.body.data.duplicatesRemoved).toBe(1);
    expect(res.body.data.invalidRecipients).toEqual(["not-an-email"]);

    const rows = await prisma.email.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);

    for (const row of rows) {
      const job = await emailQueue.getJob(emailJobId(row.id));
      expect(job).toBeDefined();
      expect(job?.delay).toBeGreaterThan(0);
    }
  });

  it("lists scheduled emails with pagination", async () => {
    const res = await request(app)
      .get("/api/emails/scheduled?page=1&pageSize=1")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.total).toBe(2);
  });

  it("returns only the user's own emails", async () => {
    const otherUser = await prisma.user.create({
      data: {
        googleId: `google-${crypto.randomUUID()}`,
        email: `other2-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: "Other 2",
      },
    });
    const otherSession = await createSession(otherUser.id);

    const res = await request(app)
      .get("/api/emails/scheduled")
      .set("Cookie", `reachinbox_session=${otherSession.token}`);
    expect(res.body.data.total).toBe(0);
  });
});

export { redis };
void closeQueue;
