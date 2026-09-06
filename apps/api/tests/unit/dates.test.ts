import { describe, it, expect } from "vitest";
import { utcHourWindow, msToNextUtcHour, computeScheduleTimes } from "../../src/utils/dates.js";

describe("utcHourWindow", () => {
  it("formats a UTC hour window id", () => {
    const date = new Date("2026-09-06T18:34:56.000Z");
    expect(utcHourWindow(date)).toBe("2026-09-06-18");
  });

  it("rolls over at the hour boundary", () => {
    expect(utcHourWindow(new Date("2026-09-06T19:00:00.000Z"))).toBe("2026-09-06-19");
  });
});

describe("msToNextUtcHour", () => {
  it("computes the distance to the next top-of-hour", () => {
    const date = new Date("2026-09-06T18:30:00.000Z");
    expect(msToNextUtcHour(date)).toBe(30 * 60 * 1000);
  });

  it("handles the last millisecond of an hour", () => {
    const date = new Date("2026-09-06T18:59:59.999Z");
    expect(msToNextUtcHour(date)).toBe(1000);
  });
});

describe("computeScheduleTimes", () => {
  it("staggers emails by the requested delay", () => {
    const start = new Date("2026-09-06T18:00:00.000Z");
    const now = new Date("2026-09-06T17:00:00.000Z");
    const times = computeScheduleTimes(start, 2000, 4, now);
    expect(times.map((t) => t.toISOString())).toEqual([
      "2026-09-06T18:00:00.000Z",
      "2026-09-06T18:00:02.000Z",
      "2026-09-06T18:00:04.000Z",
      "2026-09-06T18:00:06.000Z",
    ]);
  });

  it("never schedules in the past", () => {
    const start = new Date("2020-01-01T00:00:00.000Z");
    const now = new Date();
    const times = computeScheduleTimes(start, 1000, 3, now);
    for (const t of times) expect(t.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});
