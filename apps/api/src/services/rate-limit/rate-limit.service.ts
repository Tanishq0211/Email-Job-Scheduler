import type Redis from "ioredis";
import {
  rateLimitKey,
  sendGateKey,
  utcHourWindow,
} from "@reachinbox/shared";
import { msToNextUtcHour } from "../../utils/dates.js";
import {
  ACQUIRE_SEND_SLOT_LUA,
  RELEASE_SEND_SLOT_LUA,
} from "./rate-limit.lua.js";

export type SlotResult =
  | { acquired: true; window: string }
  | { acquired: false; reason: "hourly" | "delay"; retryInMs: number; window: string };

/**
 * Atomically claim a send slot for a sender: respects both the hourly
 * limit and the minimum delay between sends. Safe with any number of
 * concurrent workers because the check-and-increment is a single
 * Lua script execution (Redis serializes scripts).
 */
export async function acquireSendSlot(
  redis: Redis,
  senderId: string,
  hourlyLimit: number,
  minDelayMs: number,
  now: Date = new Date(),
): Promise<SlotResult> {
  const window = utcHourWindow(now);
  const result = (await redis.eval(
    ACQUIRE_SEND_SLOT_LUA,
    2,
    rateLimitKey(senderId, window),
    sendGateKey(senderId),
    hourlyLimit,
    minDelayMs,
    now.getTime(),
    msToNextUtcHour(now) + 1000, // small buffer past the boundary
  )) as [number, string, number];

  if (result[0] === 1) return { acquired: true, window };
  return {
    acquired: false,
    reason: result[1] === "hourly" ? "hourly" : "delay",
    retryInMs: Math.max(250, Number(result[2])),
    window,
  };
}

/** Give back an hourly slot when the send attempt failed. */
export async function releaseSendSlot(
  redis: Redis,
  senderId: string,
  window: string,
): Promise<void> {
  await redis.eval(RELEASE_SEND_SLOT_LUA, 1, rateLimitKey(senderId, window));
}
