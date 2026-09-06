/** All scheduling math uses absolute UTC timestamps (ISO-8601). */

/** UTC hour window id, e.g. "2026-09-06-18" for 18:00–19:00 UTC. */
export function utcHourWindow(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13).replace("T", "-");
}

/** Milliseconds until the next top-of-hour UTC boundary (min 1s). */
export function msToNextUtcHour(now: Date = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
    0,
    0,
    0,
  );
  return Math.max(1000, next - now.getTime());
}

/**
 * Per-email send times: email i goes at start + i * delay.
 * Start is never in the past.
 */
export function computeScheduleTimes(
  startTime: Date,
  delayBetweenEmailsMs: number,
  count: number,
  now: Date = new Date(),
): Date[] {
  const base = Math.max(startTime.getTime(), now.getTime());
  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    times.push(new Date(base + i * delayBetweenEmailsMs));
  }
  return times;
}
