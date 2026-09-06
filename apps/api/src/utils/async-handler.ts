import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4 does not catch rejected promises: forward async errors to
 * the error middleware explicitly. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
