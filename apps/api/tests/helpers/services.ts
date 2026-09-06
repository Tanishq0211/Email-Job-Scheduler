import { redis, closeQueue } from "../../src/queues/connection.js";
import { prisma } from "../../src/db/prisma.js";

let servicesAvailable: boolean | null = null;

/**
 * Integration tests require PostgreSQL, Redis and Elasticsearch from
 * `docker compose up -d`. When the services are not running the tests
 * are skipped cleanly instead of failing.
 */
export async function servicesUp(): Promise<boolean> {
  if (servicesAvailable !== null) return servicesAvailable;
  try {
    if (redis.status !== "ready") await redis.connect();
    await redis.ping();
    await prisma.$queryRaw`SELECT 1`;
    servicesAvailable = true;
  } catch {
    servicesAvailable = false;
  }
  return servicesAvailable;
}

export async function teardown(): Promise<void> {
  await prisma.$disconnect();
  await closeQueue();
}

export async function cleanDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    "TRUNCATE \"SlackConnection\", \"Session\", \"Email\", \"Sender\", \"User\" CASCADE",
  );
}
