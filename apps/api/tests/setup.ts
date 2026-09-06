import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Load the same .env candidates the app uses, before applying test
// overrides — otherwise defaults would shadow real credentials.
for (const candidate of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false });
    break;
  }
}
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "warn";
process.env.GOOGLE_CLIENT_ID ||= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "test-client-secret";
process.env.GOOGLE_CALLBACK_URL ||= "http://localhost:4000/auth/google/callback";
process.env.SESSION_SECRET ||= "test-session-secret-0123456789abcdef0123456789abcdef";
process.env.APP_ENCRYPTION_KEY ||= "test-encryption-key-0123456789abcdef0123456789";
process.env.SMTP_USER ||= "test@ethereal.email";
process.env.SMTP_PASSWORD ||= "test-password";
process.env.WORKER_CONCURRENCY ||= "5";
// Explicit override: tests must not inherit the root .env's production-ish
// throttle settings, otherwise 100ms test delays fail validation.
process.env.MIN_SEND_DELAY_MS = "50";
process.env.MAX_EMAILS_PER_HOUR ||= "10";
