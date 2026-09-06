import { Router } from "express";
import rateLimit from "express-rate-limit";
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
googleAuthRouter.get("/google/callback", authLimiter, googleCallback);
// NOTE: the Google strategy must run EXACTLY ONCE per callback. The
// strategy exchanges the single-use authorization code at Google's token
// endpoint; running it again (e.g. as middleware + controller) makes the
// second exchange fail with 400 invalid_grant ("Bad Request"). Failure
// handling (including SPA redirects) lives inside googleCallback.

/** /api/auth/* — session endpoints. */
export const sessionRouter = Router();
sessionRouter.post("/logout", requireAuth, asyncHandler(logout));
sessionRouter.get("/me", requireAuth, me);

export default googleAuthRouter;
