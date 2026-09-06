import type { NextFunction, Request, Response } from "express";
import { config } from "../config/env.js";
import { SESSION_COOKIE } from "../config/constants.js";
import { resolveSession } from "../services/auth/session.service.js";
import { UnauthorizedError } from "../utils/errors.js";

/** Require a valid session cookie; attaches the authenticated user. */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedError();

    const session = await resolveSession(token);
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedError("Session expired or invalid");
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      avatarUrl: session.user.avatarUrl,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function currentUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 7 * 24 * 3600 * 1000,
};
