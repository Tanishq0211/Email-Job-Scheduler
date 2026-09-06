// Manual verification helper (not part of the test suite):
//   tsx scripts/verify-restart.ts schedule   → creates a T+10s email
//   tsx scripts/verify-restart.ts check      → waits for `sent` and prints
import crypto from "node:crypto";
import { prisma } from "../src/db/prisma.js";
import { enqueueEmailJobs } from "../src/queues/email.queue.js";
import { redis } from "../src/queues/connection.js";

const [cmd] = process.argv.slice(2);

async function main() {
  if (redis.status !== "ready") await redis.connect();

  if (cmd === "schedule") {
    const user = await prisma.user.upsert({
      where: { googleId: "verify-user" },
      create: {
        googleId: "verify-user",
        email: "verify@example.com",
        name: "Restart Verification",
      },
      update: {},
    });
    const sender = await prisma.sender.upsert({
      where: { userId_email: { userId: user.id, email: process.env.SMTP_USER! } },
      create: {
        userId: user.id,
        email: process.env.SMTP_USER!,
        displayName: "Restart Verifier",
        minDelayMs: 50,
      },
      update: { minDelayMs: 50 },
    });
    const email = await prisma.email.create({
      data: {
        userId: user.id,
        senderId: sender.id,
        recipient: `restart-${crypto.randomUUID().slice(0, 8)}@example.com`,
        subject: "Restart persistence check",
        body: "If you can read this in Ethereal, restart safety works.",
        scheduledAt: new Date(Date.now() + 10_000),
      },
    });
    await enqueueEmailJobs([{ id: email.id, scheduledAt: email.scheduledAt }]);
    console.log(`SCHEDULED ${email.id} (fires ~10s from now)`);
  } else if (cmd === "check") {
    const email = await prisma.email.findFirstOrThrow({
      where: { subject: "Restart persistence check" },
      orderBy: { createdAt: "desc" },
    });
    for (let i = 0; i < 60 && email.status !== "sent" && email.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const fresh = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
      email.status = fresh.status;
      email.messageId = fresh.messageId;
    }
    console.log(`RESULT ${email.status} messageId=${email.messageId ?? "none"}`);
    if (email.status !== "sent") process.exit(1);
  } else {
    console.error("usage: tsx scripts/verify-restart.ts <schedule|check>");
    process.exit(1);
  }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
