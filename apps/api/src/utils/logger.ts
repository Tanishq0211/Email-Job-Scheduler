import pino from "pino";
import { config } from "../config/env.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "reachinbox-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "token",
      "accessToken",
      "smtpPassword",
    ],
    censor: "[REDACTED]",
  },
  transport: config.isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
      },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
