import { describe, it, expect } from "vitest";
import { ScheduleRequestSchema } from "@reachinbox/shared";

const valid = {
  subject: "Hello",
  body: "World",
  senderId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  startTime: "2026-09-06T18:00:00.000Z",
  delayBetweenEmailsMs: 2000,
  hourlyLimit: 200,
  recipients: ["a@example.com"],
};

describe("ScheduleRequestSchema", () => {
  it("accepts a valid request", () => {
    const parsed = ScheduleRequestSchema.parse(valid);
    expect(parsed.recipients).toEqual(["a@example.com"]);
    expect(parsed.startTime).toBeInstanceOf(Date);
  });

  it("requires subject and body", () => {
    expect(() => ScheduleRequestSchema.parse({ ...valid, subject: "" })).toThrow();
    expect(() => ScheduleRequestSchema.parse({ ...valid, body: "" })).toThrow();
  });

  it("requires at least one recipient", () => {
    expect(() => ScheduleRequestSchema.parse({ ...valid, recipients: [] })).toThrow();
  });

  it("accepts raw recipient strings; strict validation happens in the scheduler", () => {
    // Invalid addresses are reported by sanitizeRecipients, not rejected
    // at the schema boundary, so the API can respond with invalidRecipients.
    const parsed = ScheduleRequestSchema.parse({
      ...valid,
      recipients: ["a@example.com", "not-an-email"],
    });
    expect(parsed.recipients).toEqual(["a@example.com", "not-an-email"]);
  });

  it("requires a positive hourly limit", () => {
    expect(() => ScheduleRequestSchema.parse({ ...valid, hourlyLimit: 0 })).toThrow();
  });

  it("requires a valid uuid senderId", () => {
    expect(() => ScheduleRequestSchema.parse({ ...valid, senderId: "abc" })).toThrow();
  });
});
