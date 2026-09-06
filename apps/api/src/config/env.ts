import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// npm workspace scripts run with the package dir as CWD; support both the
// package-level and the repo-root .env without depending on CWD luck.
for (const candidate of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false });
    break;
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  ELASTICSEARCH_URL: z.string().min(1, "ELASTICSEARCH_URL is required"),
  ELASTICSEARCH_INDEX: z.string().default("emails"),

  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_ENCRYPTION_KEY: z
    .string()
    .min(32, "APP_ENCRYPTION_KEY must be at least 32 characters"),

  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_CALLBACK_URL: z.string().url(),

  // Slack is an optional integration: when unset, connect endpoints
  // respond with a clear 503 and the rest of the system is unaffected.
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().url().optional(),

  SMTP_HOST: z.string().default("smtp.ethereal.email"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1, "SMTP_USER is required (Ethereal credentials)"),
  SMTP_PASSWORD: z.string().min(1, "SMTP_PASSWORD is required"),
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  MIN_SEND_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().positive().default(200),
  MAX_RECIPIENTS_PER_REQUEST: z.coerce.number().int().positive().default(5000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast: missing/invalid configuration should kill the process at boot.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  frontendUrl: env.FRONTEND_URL,

  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  elasticsearchUrl: env.ELASTICSEARCH_URL,
  elasticsearchIndex: env.ELASTICSEARCH_INDEX,

  sessionSecret: env.SESSION_SECRET,
  encryptionKey: env.APP_ENCRYPTION_KEY,

  cookieSecure: env.COOKIE_SECURE,

  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_CALLBACK_URL,
  },

  slack: {
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    redirectUri: env.SLACK_REDIRECT_URI,
    get configured(): boolean {
      return Boolean(
        env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_REDIRECT_URI,
      );
    },
  },

  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    secure: env.SMTP_SECURE,
  },

  workerConcurrency: env.WORKER_CONCURRENCY,
  minSendDelayMs: env.MIN_SEND_DELAY_MS,
  maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
  maxRecipientsPerRequest: env.MAX_RECIPIENTS_PER_REQUEST,
} as const;

export type AppConfig = typeof config;
