import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

export function notFoundHandler(
  _req: Request,
  res: Response,
): void {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
}

/** Structural check: instanceof can fail when zod is loaded in two
 * module graphs (e.g. bundled vs externalized CJS in tests). */
function isZodError(err: unknown): err is ZodError {
  return (
    err instanceof ZodError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: unknown }).name === "ZodError" &&
      Array.isArray((err as { issues?: unknown }).issues))
  );
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (isZodError(err)) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
    return;
  }

  logger.error(
    { err, requestId: req.requestId, path: req.path },
    "unhandled error",
  );

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: config.isProd
        ? "Internal server error"
        : err instanceof Error
          ? err.message
          : "Internal server error",
    },
  });
}
