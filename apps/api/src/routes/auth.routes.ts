import { Router } from "express";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { config } from "../config/env.js";
import {
  startGoogleAuth,
  googleCallback,
  logout,
  me,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

/** /auth/google + /auth/google/callback — Google OAuth redirect flow. */
export const googleAuthRouter = Router();
googleAuthRouter.get("/google", authLimiter, startGoogleAuth);
googleAuthRouter.get(
  "/google/callback",
  authLimiter,
  // Strategy-level failures (bad credentials, denied consent) go back to
  // the SPA login page, not a backend 404.
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${config.frontendUrl}/login?error=oauth_failed`,
  }),
  googleCallback,
);

/** /api/auth/* — session endpoints. */
export const sessionRouter = Router();
sessionRouter.post("/logout", requireAuth, asyncHandler(logout));
sessionRouter.get("/me", requireAuth, me);

export default googleAuthRouter;
