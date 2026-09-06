import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { redis, waitUntilQueueReady, closeQueue } from "./queues/connection.js";
import { startEmailWorker } from "./queues/email.worker.js";
import { reconcileEmailJobs } from "./services/scheduler/job-reconciliation.service.js";
import { prisma } from "./db/prisma.js";

async function main(): Promise<void> {
  await waitUntilQueueReady();
  if (redis.status !== "ready") await redis.connect();

  const worker = startEmailWorker();
  await reconcileEmailJobs();

  logger.info(
    {
      concurrency: config.workerConcurrency,
      minSendDelayMs: config.minSendDelayMs,
      maxEmailsPerHour: config.maxEmailsPerHour,
    },
    "worker process ready",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await worker.close();
    await prisma.$disconnect();
    await closeQueue();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandled promise rejection in worker");
});

main().catch((err) => {
  logger.error({ err }, "failed to start worker");
  process.exit(1);
});
