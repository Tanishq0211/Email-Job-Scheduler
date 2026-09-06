import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { redis } from "../queues/connection.js";
import { esClient } from "../services/elasticsearch/elasticsearch.service.js";

/** GET /health — liveness probe (process is up). */
export function health(_req: Request, res: Response): void {
  res.json({ success: true, data: { status: "ok", uptime: process.uptime() } });
}

/** GET /health/ready — verifies PostgreSQL, Redis, Elasticsearch. */
export async function readiness(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, { ok: boolean; error?: string }> = {
    postgres: { ok: false },
    redis: { ok: false },
    elasticsearch: { ok: false },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { ok: true };
  } catch (err) {
    checks.postgres = { ok: false, error: (err as Error).message };
  }

  try {
    if (redis.status !== "ready") await redis.connect();
    await redis.ping();
    checks.redis = { ok: true };
  } catch (err) {
    checks.redis = { ok: false, error: (err as Error).message };
  }

  try {
    await esClient.ping();
    checks.elasticsearch = { ok: true };
  } catch (err) {
    checks.elasticsearch = { ok: false, error: (err as Error).message };
  }

  const ready = Object.values(checks).every((c) => c.ok);
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: { status: ready ? "ready" : "degraded", checks },
  });
}
