import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { redis, waitUntilQueueReady, closeQueue } from "./queues/connection.js";
import { configureGoogleOAuth } from "./services/auth/google.service.js";
import { purgeExpiredSessions } from "./services/auth/session.service.js";
import { reconcileEmailJobs } from "./services/scheduler/job-reconciliation.service.js";
import { ensureEmailIndex, reconcileEmailIndex } from "./services/elasticsearch/elasticsearch.service.js";
import { prisma } from "./db/prisma.js";

async function main(): Promise<void> {
  configureGoogleOAuth();
  await waitUntilQueueReady();
  if (redis.status !== "ready") await redis.connect();
  await ensureEmailIndex();

  // Recovery, not scheduling: recreate only missing BullMQ jobs and
  // repair the Elasticsearch projection. Runs once per boot.
  await reconcileEmailJobs();
  await reconcileEmailIndex((since) =>
    prisma.email.findMany({
      where: { updatedAt: { gte: since } },
      take: 5000,
      orderBy: { updatedAt: "desc" },
    }),
  );
  await purgeExpiredSessions();

  const app = createApp();
  const server = http.createServer(app);
  server.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close();
    // Force-exit if lingering keep-alive connections block a clean close.
    setTimeout(() => process.exit(1), 10_000).unref();
    await prisma.$disconnect();
    await closeQueue();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandled promise rejection");
});

main().catch((err) => {
  logger.error({ err }, "failed to start API");
  process.exit(1);
});
