import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import { redis } from "../../src/queues/connection.js";
import { slackAlertKey, utcHourWindow } from "@reachinbox/shared";
import { notifyRateLimitReached } from "../../src/services/slack/slack.notification.service.js";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { createSession } from "../../src/services/auth/session.service.js";
import { servicesUp, teardown } from "../helpers/services.js";
import type { Express } from "express";

let app: Express;
let cookie: string;

beforeAll(async () => {
  if (!(await servicesUp())) return;
  if (redis.status !== "ready") await redis.connect();
  app = createApp();
  const user = await prisma.user.create({
    data: {
      googleId: `google-${crypto.randomUUID()}`,
      email: `slack-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: "Slack Test",
    },
  });
  const session = await createSession(user.id);
  cookie = `reachinbox_session=${session.token}`;
});

afterAll(async () => {
  await teardown();
});

describe.skipIf(!(await servicesUp()))("Slack integration", () => {
  it("returns 503 when Slack OAuth is not configured on the server", async () => {
    const res = await request(app).get("/auth/slack").set("Cookie", cookie);
    // Test env has no SLACK_CLIENT_ID, so the connect endpoint must refuse
    // clearly instead of redirecting to a broken authorize URL.
    expect(res.status).toBe(503);
  });

  it("deduplicates rate-limit alerts per sender+window via atomic SET NX", async () => {
    const senderId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const now = new Date();
    const params = {
      userId,
      senderId,
      senderEmail: "no-connection@example.com",
      hourlyLimit: 3,
    };

    // 20 blocked emails → the alert key is created exactly once.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        notifyRateLimitReached(redis, params, now),
      ),
    );

    const key = slackAlertKey(senderId, utcHourWindow(now));
    const value = await redis.get(key);
    expect(value).toBe("1");
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(3500); // ~1h expiry, not expiring early

    // A different UTC hour window gets its own (absent) key → new alert
    // allowed for hour 19 after hour 18.
    const nextHour = new Date(now.getTime() + 3_600_000);
    const nextKey = slackAlertKey(senderId, utcHourWindow(nextHour));
    expect(nextKey).not.toBe(key);
    expect(await redis.get(nextKey)).toBe(null);
  });

  it("is a no-op (never throws) when no Slack connection exists", async () => {
    const params = {
      userId: crypto.randomUUID(),
      senderId: crypto.randomUUID(),
      senderEmail: "none@example.com",
      hourlyLimit: 1,
    };
    await expect(notifyRateLimitReached(redis, params)).resolves.toBeUndefined();
  });
});
