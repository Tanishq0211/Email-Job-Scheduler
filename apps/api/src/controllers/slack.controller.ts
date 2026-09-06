import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import {
  buildAuthorizeUrl,
  exchangeCodeAndConnect,
  getConnection,
  disconnect,
} from "../services/slack/slack.oauth.service.js";
import { issueOAuthState, assertOAuthState } from "./auth.controller.js";
import { config } from "../config/env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ operation: "slack.controller" });

/** GET /auth/slack — redirect to Slack's OAuth authorize page. */
export function startSlackAuth(_req: Request, res: Response): void {
  const state = issueOAuthState(res);
  res.redirect(buildAuthorizeUrl(state));
}

/** GET /auth/slack/callback — exchange code, persist encrypted connection. */
export async function slackCallback(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    assertOAuthState(req, res);
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!code) throw new Error("missing code");

    const user = currentUser(req);
    await exchangeCodeAndConnect(code, user.id);
    res.redirect(`${config.frontendUrl}/?slack=connected`);
  } catch (err) {
    log.warn({ err }, "slack callback failed");
    res.redirect(`${config.frontendUrl}/?slack=failed`);
  }
}

/** GET /api/slack/status */
export async function slackStatus(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const connection = await getConnection(user.id);
  res.json({
    success: true,
    data: {
      connected: Boolean(connection),
      teamName: connection?.teamName ?? null,
      channelId: connection?.channelId ?? null,
    },
  });
}

/** POST /api/slack/disconnect */
export async function slackDisconnect(
  req: Request,
  res: Response,
): Promise<void> {
  const user = currentUser(req);
  const removed = await disconnect(user.id);
  res.json({ success: true, data: { disconnected: removed } });
}
