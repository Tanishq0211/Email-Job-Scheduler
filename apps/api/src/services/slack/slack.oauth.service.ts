import { config } from "../../config/env.js";
import { encrypt, decrypt } from "../../utils/crypto.js";
import { prisma } from "../../db/prisma.js";
import { childLogger } from "../../utils/logger.js";
import { ServiceUnavailableError } from "../../utils/errors.js";

const log = childLogger({ operation: "slack.oauth" });

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";
// chat:write for chat.postMessage; incoming-webhook so the installer picks
// a channel and we receive a channel_id + webhook in the token response.
const SCOPES = "chat:write,incoming-webhook";

export function slackConfigured(): boolean {
  return config.slack.configured;
}

export function buildAuthorizeUrl(state: string): string {
  if (!slackConfigured()) {
    throw new ServiceUnavailableError(
      "Slack integration is not configured on this server",
    );
  }
  const params = new URLSearchParams({
    client_id: config.slack.clientId!,
    scope: SCOPES,
    redirect_uri: config.slack.redirectUri!,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface SlackTokenResponse {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  access_token?: string;
  incoming_webhook?: { channel_id?: string; url?: string };
}

/** Exchange the OAuth code for tokens and persist the (encrypted) connection. */
export async function exchangeCodeAndConnect(
  code: string,
  userId: string,
): Promise<{ teamName: string; channelId: string | null }> {
  if (!slackConfigured()) {
    throw new ServiceUnavailableError(
      "Slack integration is not configured on this server",
    );
  }

  const params = new URLSearchParams({
    client_id: config.slack.clientId!,
    client_secret: config.slack.clientSecret!,
    code,
    redirect_uri: config.slack.redirectUri!,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = (await response.json()) as SlackTokenResponse;

  if (!data.ok || !data.access_token) {
    log.warn({ slackError: data.error }, "slack token exchange failed");
    throw new ServiceUnavailableError(
      `Slack OAuth failed: ${data.error ?? "unknown error"}`,
    );
  }

  const teamName = data.team?.name ?? "Unknown workspace";
  const channelId = data.incoming_webhook?.channel_id ?? null;

  await prisma.slackConnection.upsert({
    where: { userId },
    create: {
      userId,
      teamId: data.team?.id ?? "unknown",
      teamName,
      accessToken: encrypt(data.access_token),
      webhookUrl: data.incoming_webhook?.url
        ? encrypt(data.incoming_webhook.url)
        : null,
      channelId,
    },
    update: {
      teamId: data.team?.id ?? "unknown",
      teamName,
      accessToken: encrypt(data.access_token),
      webhookUrl: data.incoming_webhook?.url
        ? encrypt(data.incoming_webhook.url)
        : null,
      channelId,
    },
  });

  log.info({ userId, teamId: data.team?.id }, "slack connected");
  return { teamName, channelId };
}

export async function getConnection(userId: string) {
  return prisma.slackConnection.findUnique({ where: { userId } });
}

export async function disconnect(userId: string): Promise<boolean> {
  const existing = await getConnection(userId);
  if (!existing) return false;
  await prisma.slackConnection.delete({ where: { userId } });
  log.info({ userId }, "slack disconnected");
  return true;
}

export function decryptToken(encrypted: string): string {
  return decrypt(encrypted);
}
