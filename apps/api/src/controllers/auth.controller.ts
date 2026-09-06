import type { Request, Response } from "express";
import passport from "passport";
import { config } from "../config/env.js";
import { SESSION_COOKIE, OAUTH_STATE_COOKIE } from "../config/constants.js";
import {
  createSession,
  destroySession,
} from "../services/auth/session.service.js";
import {
  createOAuthState,
  timingSafeEqual,
  verifyOAuthState,
} from "../utils/crypto.js";
import { UnauthorizedError } from "../utils/errors.js";
import { sessionCookieOptions } from "../middleware/auth.middleware.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ operation: "auth.controller" });

/** GET /auth/google — begin the Google OAuth flow (with signed state). */
export function startGoogleAuth(req: Request, res: Response): void {
  const state = createOAuthState();
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });
  passport.authenticate("google", {
    session: false,
    scope: ["profile", "email"],
    state,
  })(req, res);
}

/** GET /auth/google/callback — verify state, upsert user, create session. */
export function googleCallback(req: Request, res: Response): void {
  passport.authenticate("google", { session: false }, async (err, user) => {
    try {
      const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE];
      const stateValid =
        stateCookie &&
        req.query.state &&
        typeof req.query.state === "string" &&
        timingSafeEqual(stateCookie, req.query.state) &&
        verifyOAuthState(req.query.state);
      res.clearCookie(OAUTH_STATE_COOKIE);

      if (err || !user || !stateValid) {
        log.warn({ err: err?.message }, "google callback failed");
        res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
        return;
      }

      const session = await createSession(user.id);
      res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions);
      res.redirect(`${config.frontendUrl}/?login=success`);
    } catch (cbErr) {
      log.error({ err: cbErr }, "session creation failed");
      res.redirect(`${config.frontendUrl}/login?error=session_failed`);
    }
  })(req, res);
}

/** POST /auth/logout — invalidate server-side session, clear cookie. */
export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ success: true, data: { loggedOut: true } });
}

/** GET /api/auth/me */
export function me(req: Request, res: Response): void {
  res.json({ success: true, data: { user: req.user } });
}

/** Shared state helpers for Slack OAuth (kept beside auth flows). */
export function issueOAuthState(res: Response): string {
  const state = createOAuthState();
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });
  return state;
}

/** Verify the double-submit OAuth state (cookie + query) and clear it. */
export function assertOAuthState(req: Request, res: Response): void {
  const cookie = req.cookies?.[OAUTH_STATE_COOKIE];
  const queryState =
    typeof req.query.state === "string" ? req.query.state : undefined;
  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
  if (
    !cookie ||
    !queryState ||
    !timingSafeEqual(cookie, queryState) ||
    !verifyOAuthState(queryState)
  ) {
    throw new UnauthorizedError("Invalid OAuth state");
  }
}
