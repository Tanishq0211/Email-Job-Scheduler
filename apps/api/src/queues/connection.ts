import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config/env.js";
import { QUEUE_NAME } from "@reachinbox/shared";
import { logger } from "../utils/logger.js";

/** BullMQ requires blocking-capable connections. */
export function createQueueConnection(): IORedis {
  return new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
}

/** General-purpose Redis client for rate limiting / dedup keys. */
export const redis = new IORedis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue(QUEUE_NAME, {
  connection: createQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 24 * 3600, count: 5000 },
  },
});

export async function waitUntilQueueReady(): Promise<void> {
  await emailQueue.waitUntilReady();
  logger.info("queue connected");
}

export async function closeQueue(): Promise<void> {
  await emailQueue.close();
  redis.disconnect();
}
