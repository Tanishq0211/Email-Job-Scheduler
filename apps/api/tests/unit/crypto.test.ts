import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  createOAuthState,
  verifyOAuthState,
  sha256,
} from "../../src/utils/crypto.js";

describe("AES-256-GCM token encryption", () => {
  it("round-trips a Slack token", () => {
    const token = "xoxb-123456-abcdef";
    const cipher = encrypt(token);
    expect(cipher).not.toContain(token);
    expect(decrypt(cipher)).toBe(token);
  });

  it("rejects tampered ciphertext", () => {
    const cipher = encrypt("secret");
    const parts = cipher.split(":");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});

describe("OAuth state signing", () => {
  it("verifies a freshly issued state", () => {
    const state = createOAuthState();
    expect(verifyOAuthState(state)).toBe(true);
  });

  it("rejects forged or malformed states", () => {
    expect(verifyOAuthState(undefined)).toBe(false);
    expect(verifyOAuthState("abc")).toBe(false);
    expect(verifyOAuthState("abc.deadbeef")).toBe(false);
    const [nonce] = createOAuthState().split(".");
    expect(verifyOAuthState(`${nonce}.deadbeef`)).toBe(false);
  });
});

describe("sha256", () => {
  it("hashes session tokens deterministically", () => {
    expect(sha256("token")).toBe(sha256("token"));
    expect(sha256("token")).toHaveLength(64);
    expect(sha256("token")).not.toBe("token");
  });
});
