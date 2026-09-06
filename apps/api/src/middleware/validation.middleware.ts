import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Zod validation middleware; parsed values replace the originals. */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        // Express 5+/4 query is a plain object; safe replace for handlers.
        (req as Request & { query: unknown }).query =
          schemas.query.parse(req.query);
      }
      if (schemas.params) {
        (req as Request & { params: unknown }).params =
          schemas.params.parse(req.params);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
