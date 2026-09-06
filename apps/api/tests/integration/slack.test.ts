import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { redis } from "../../src/queues/connection.js";
import { slackAlertKey, utcHourWindow } from "@reachinbox/shared";
import { notifyRateLimitReached } from "../../src/services/slack/slack.notification.service.js";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { createSession } from "../../src/services/auth/session.service.js";
import { encrypt } from "../../src/utils/crypto.js";
import { config } from "../../src/config/env.js";
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

/** Minimal local HTTP server standing in for Slack's webhook endpoint. */
async function startWebhookStub() {
  let mode: "ok" | "error" = "ok";
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.statusCode = mode === "ok" ? 200 : 500;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setMode: (m: "ok" | "error") => (mode = m),
    hits: () => hits,
  };
}

async function createConnectedUser(webhookUrl: string) {
  const user = await prisma.user.create({
    data: {
      googleId: `google-${crypto.randomUUID()}`,
      email: `slack-conn-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: "Slack Connected",
      slackConnec: {
        create: {
          teamId: "T123",
          teamName: "Test Workspace",
          accessToken: encrypt("xoxb-test-token"),
          webhookUrl: encrypt(webhookUrl),
          channelId: "C123",
        },
      },
    },
    include: { slackConnec: true },
  });
  return user;
}

function alertParams(userId: string, senderId: string) {
  return {
    userId,
    senderId,
    senderEmail: "alerts@example.com",
    hourlyLimit: 3,
  };
}

describe.skipIf(!(await servicesUp()))("Slack integration", () => {
  it("handles /auth/slack according to server configuration", async () => {
    const res = await request(app).get("/auth/slack").set("Cookie", cookie);
    if (config.slack.configured) {
      // Real credentials present: the endpoint must redirect to Slack's
      // authorize page with the signed state parameter.
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(
        "https://slack.com/oauth/v2/authorize",
      );
      expect(res.headers.location).toContain("state=");
    } else {
      // No credentials: refuse clearly instead of redirecting to a
      // broken authorize URL.
      expect(res.status).toBe(503);
    }
  });

  it("does not create the dedup key when no Slack connection exists", async () => {
    const senderId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const now = new Date();

    await expect(
      notifyRateLimitReached(redis, alertParams(userId, senderId), now),
    ).resolves.toBeUndefined();

    const key = slackAlertKey(senderId, utcHourWindow(now));
    expect(await redis.get(key)).toBe(null);
  });

  it("sends exactly one notification per sender/hour on successful delivery", async () => {
    const stub = await startWebhookStub();
    try {
      const user = await createConnectedUser(stub.url);
      const senderId = crypto.randomUUID();
      const now = new Date();

      // A burst of blocked emails in the same window → one delivery.
      await Promise.all(
        Array.from({ length: 10 }, () =>
          notifyRateLimitReached(redis, alertParams(user.id, senderId), now),
        ),
      );

      expect(stub.hits()).toBe(1);
      const key = slackAlertKey(senderId, utcHourWindow(now));
      expect(await redis.get(key)).toBe("1");
      expect(await redis.ttl(key)).toBeGreaterThan(3500);
    } finally {
      await stub.close();
    }
  });

  it("releases the dedup key on failed delivery so a later event can retry", async () => {
    const stub = await startWebhookStub();
    try {
      stub.setMode("error");
      const user = await createConnectedUser(stub.url);
      const senderId = crypto.randomUUID();
      const now = new Date();
      const key = slackAlertKey(senderId, utcHourWindow(now));

      await notifyRateLimitReached(redis, alertParams(user.id, senderId), now);
      expect(stub.hits()).toBe(1);
      expect(await redis.get(key)).toBe(null); // reservation released

      // Slack recovers mid-hour → the next rate-limit event notifies.
      stub.setMode("ok");
      await notifyRateLimitReached(redis, alertParams(user.id, senderId), now);
      expect(stub.hits()).toBe(2);
      expect(await redis.get(key)).toBe("1");
    } finally {
      await stub.close();
    }
  });

  it("allows a new alert in the next hour window after a sent alert", async () => {
    const stub = await startWebhookStub();
    try {
      const user = await createConnectedUser(stub.url);
      const senderId = crypto.randomUUID();
      const now = new Date();
      const nextHour = new Date(now.getTime() + 3_600_000);

      await notifyRateLimitReached(redis, alertParams(user.id, senderId), now);
      await notifyRateLimitReached(redis, alertParams(user.id, senderId), nextHour);

      expect(stub.hits()).toBe(2);
      expect(await redis.get(slackAlertKey(senderId, utcHourWindow(now)))).toBe("1");
      expect(await redis.get(slackAlertKey(senderId, utcHourWindow(nextHour)))).toBe("1");
    } finally {
      await stub.close();
    }
  });

  it("never throws when delivery fails (email processing unaffected)", async () => {
    const user = await createConnectedUser("http://127.0.0.1:1/unreachable");
    await expect(
      notifyRateLimitReached(redis, alertParams(user.id, crypto.randomUUID())),
    ).resolves.toBeUndefined();
  });
});
