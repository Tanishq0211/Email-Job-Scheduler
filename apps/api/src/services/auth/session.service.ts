import { randomBytes } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { sha256 } from "../../utils/crypto.js";

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/**
 * Opaque session tokens: the raw token is stored only in an HTTP-only
 * cookie; PostgreSQL stores its SHA-256 hash. The token itself never
 * touches the database.
 */
export async function createSession(userId: string): Promise<CreatedSession> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function resolveSession(token: string) {
  return prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { user: true, expiresAt: true },
  });
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

/** Delete expired sessions; run at startup, not on a timer. */
export async function purgeExpiredSessions(): Promise<void> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    // eslint-disable-next-line no-console
    console.log(`purged ${result.count} expired sessions`);
  }
}
