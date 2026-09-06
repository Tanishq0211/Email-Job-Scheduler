import { describe, it, expect } from "vitest";
import { parseRecipients, sanitizeRecipients, isValidEmail } from "../../src/utils/email-parser.js";

describe("isValidEmail", () => {
  it("accepts valid addresses", () => {
    expect(isValidEmail("alice@example.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.domain.co.uk")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("@nope.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("parseRecipients (CSV/TXT)", () => {
  it("parses a single-column CSV with header", () => {
    const raw = "email\nalice@example.com\nbob@example.com\n";
    const result = parseRecipients(raw);
    expect(result.valid).toEqual(["alice@example.com", "bob@example.com"]);
    expect(result.invalid).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("parses a name,email CSV", () => {
    const raw = "name,email\nAlice,alice@example.com\nBob,bob@example.com\n";
    const result = parseRecipients(raw);
    expect(result.valid).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("parses a plain TXT list", () => {
    const raw = "alice@example.com\nbob@example.com\ncharlie@example.com";
    const result = parseRecipients(raw);
    expect(result.valid).toHaveLength(3);
  });

  it("ignores blank rows and trims whitespace", () => {
    const raw = "email\n  alice@example.com  \n\n   \nbob@example.com\n";
    const result = parseRecipients(raw);
    expect(result.valid).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("removes duplicates case-insensitively and reports the count", () => {
    const raw = "email\nalice@example.com\nALICE@example.com\nalice@example.com\n";
    const result = parseRecipients(raw);
    expect(result.valid).toEqual(["alice@example.com"]);
    expect(result.duplicatesRemoved).toBe(2);
  });

  it("reports invalid addresses instead of accepting them", () => {
    const raw = "email\nalice@example.com\nnot-an-email\nbob@@broken\n";
    const result = parseRecipients(raw);
    expect(result.valid).toEqual(["alice@example.com"]);
    expect(result.invalid).toEqual(["not-an-email", "bob@@broken"]);
  });
});

describe("sanitizeRecipients (backend re-validation)", () => {
  it("never trusts the frontend: re-validates, dedupes, lowercases", () => {
    const result = sanitizeRecipients([
      "Alice@Example.com",
      "alice@example.com",
      "broken",
      "  bob@example.com  ",
    ]);
    expect(result.valid).toEqual(["alice@example.com", "bob@example.com"]);
    expect(result.invalid).toEqual(["broken"]);
    expect(result.duplicatesRemoved).toBe(1);
  });
});
