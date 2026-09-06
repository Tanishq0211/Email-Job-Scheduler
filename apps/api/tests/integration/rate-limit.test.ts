import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { acquireSendSlot, releaseSendSlot } from "../../src/services/rate-limit/rate-limit.service.js";
import { redis } from "../../src/queues/connection.js";
import { rateLimitKey, sendGateKey, utcHourWindow } from "@reachinbox/shared";
import { servicesUp, teardown } from "../helpers/services.js";

beforeAll(async () => {
  if (!(await servicesUp())) return;
  if (redis.status !== "ready") await redis.connect();
});

afterAll(async () => {
  await teardown();
});

describe.skipIf(!(await servicesUp()))("Redis distributed rate limiting", () => {
  const senderId = crypto.randomUUID();

  function keys(now: Date) {
    return {
      counter: rateLimitKey(senderId, utcHourWindow(now)),
      gate: sendGateKey(senderId),
    };
  }

  it("allows sends up to the hourly limit, then blocks", async () => {
    const now = new Date();
    const { counter, gate } = keys(now);
    await redis.del(counter, gate);

    for (let i = 0; i < 3; i++) {
      const result = await acquireSendSlot(redis, senderId, 3, 0, now);
      expect(result.acquired).toBe(true);
    }

    const blocked = await acquireSendSlot(redis, senderId, 3, 0, now);
    expect(blocked.acquired).toBe(false);
    if (!blocked.acquired) {
      expect(blocked.reason).toBe("hourly");
      expect(blocked.retryInMs).toBeGreaterThan(0);
    }
  });

  it("enforces the minimum delay across sequential calls", async () => {
    const now = new Date();
    const { counter, gate } = keys(now);
    await redis.del(counter, gate);

    const first = await acquireSendSlot(redis, senderId, 100, 2000, now);
    expect(first.acquired).toBe(true);

    const second = await acquireSendSlot(
      redis,
      senderId,
      100,
      2000,
      new Date(now.getTime() + 500),
    );
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.reason).toBe("delay");
      expect(second.retryInMs).toBeGreaterThan(0);
      expect(second.retryInMs).toBeLessThanOrEqual(1500);
    }
  });

  it("releases a slot after a failed send", async () => {
    const now = new Date();
    const { counter, gate } = keys(now);
    await redis.del(counter, gate);

    await acquireSendSlot(redis, senderId, 1, 0, now);
    expect(await acquireSendSlot(redis, senderId, 1, 0, now)).toMatchObject({
      acquired: false,
    });

    await releaseSendSlot(redis, senderId, utcHourWindow(now));
    expect(await acquireSendSlot(redis, senderId, 1, 0, now)).toMatchObject({
      acquired: true,
    });
  });

  it("is consistent under concurrent acquisition (multi-worker safety)", async () => {
    const now = new Date();
    const { counter, gate } = keys(now);
    await redis.del(counter, gate);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        acquireSendSlot(redis, senderId, 5, 0, now),
      ),
    );
    const acquired = results.filter((r) => r.acquired).length;
    expect(acquired).toBe(5);
  });
});
