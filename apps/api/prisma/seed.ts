import { prisma } from "../src/db/prisma.js";
import { config } from "../src/config/env.js";

/**
 * Demo seed: creates a default sender for every existing user so the
 * Compose flow works immediately after login. Run: npm run db:seed
 */
async function main(): Promise<void> {
  const users = await prisma.user.findMany({ include: { senders: true } });

  for (const user of users) {
    if (user.senders.length > 0) continue;
    await prisma.sender.create({
      data: {
        userId: user.id,
        email: config.smtp.user,
        displayName: user.name || "Demo Sender",
        hourlyLimit: config.maxEmailsPerHour,
        minDelayMs: config.minSendDelayMs,
      },
    });
    console.log(`seeded default sender for ${user.email}`);
  }

  if (users.length === 0) {
    console.log("no users yet — log in once with Google, then re-run seed");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
