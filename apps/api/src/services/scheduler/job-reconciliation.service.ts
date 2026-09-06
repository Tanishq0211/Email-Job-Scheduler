import { prisma } from "../../db/prisma.js";
import { enqueueEmailJobs, jobExists } from "../../queues/email.queue.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ operation: "job.reconciliation" });

/** A `processing` email whose job vanished (e.g. crash mid-send) is only
 * reset to scheduled if it has been stuck longer than this. */
const STUCK_PROCESSING_MS = 10 * 60 * 1000;

/**
 * Startup recovery, NOT a scheduler: find emails in `scheduled` (and
 * long-stuck `processing`) whose BullMQ job no longer exists and
 * recreate only those, using deterministic job IDs. Existing jobs are
 * never duplicated. Runs once at boot of the API or worker.
 */
export async function reconcileEmailJobs(): Promise<{
  recreated: number;
  reset: number;
}> {
  let reset = 0;

  const stuckCut = new Date(Date.now() - STUCK_PROCESSING_MS);
  const stuck = await prisma.email.findMany({
    where: { status: "processing", updatedAt: { lt: stuckCut } },
    select: { id: true },
  });

  for (const email of stuck) {
    if (!(await jobExists(email.id))) {
      await prisma.email.updateMany({
        where: { id: email.id, status: "processing" },
        data: { status: "scheduled" },
      });
      reset++;
    }
  }

  const scheduled = await prisma.email.findMany({
    where: { status: "scheduled" },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
  });

  const missing: { id: string; scheduledAt: Date }[] = [];
  for (const email of scheduled) {
    if (!(await jobExists(email.id))) missing.push(email);
  }

  if (missing.length > 0) {
    await enqueueEmailJobs(missing);
  }

  log.info(
    {
      scanned: scheduled.length + stuck.length,
      recreated: missing.length,
      resetToScheduled: reset,
    },
    "startup job reconciliation complete",
  );

  return { recreated: missing.length, reset };
}
