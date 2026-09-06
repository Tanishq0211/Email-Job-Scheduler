import { Router } from "express";
import {
  startSlackAuth,
  slackCallback,
  slackStatus,
  slackDisconnect,
} from "../controllers/slack.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";

/** /auth/slack + /auth/slack/callback — OAuth redirect flow. */
export const slackAuthRouter = Router();
slackAuthRouter.get("/", requireAuth, startSlackAuth);
slackAuthRouter.get("/callback", requireAuth, asyncHandler(slackCallback));

/** /api/slack/* — connection status and disconnect. */
export const slackApiRouter = Router();
slackApiRouter.use(requireAuth);
slackApiRouter.get("/status", asyncHandler(slackStatus));
slackApiRouter.post("/disconnect", asyncHandler(slackDisconnect));
