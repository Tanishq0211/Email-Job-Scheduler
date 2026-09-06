import { WebClient } from "@slack/web-api";
import { slackAlertKey, utcHourWindow } from "@reachinbox/shared";
import type Redis from "ioredis";
import { prisma } from "../../db/prisma.js";
import { childLogger } from "../../utils/logger.js";
import { decryptToken } from "./slack.oauth.service.js";

const log = childLogger({ operation: "slack.notify" });

/**
 * Notify the connected Slack workspace that a sender hit its hourly
 * rate limit. Deduplicated per (sender, hour window) with an atomic
 * Redis SET NX, so a burst of blocked emails produces exactly one alert.
 * A missing Slack connection is a no-op: the email system continues.
 */
export async function notifyRateLimitReached(
  redis: Redis,
  params: {
    userId: string;
    senderId: string;
    senderEmail: string;
    hourlyLimit: number;
  },
  now: Date = new Date(),
): Promise<void> {
  const { userId, senderId, senderEmail, hourlyLimit } = params;
  const window = utcHourWindow(now);

  try {
    const dedupKey = slackAlertKey(senderId, window);
    const isNew = await redis.set(dedupKey, "1", "EX", 3600, "NX");
    if (isNew !== "OK") return; // alert already sent for this window

    const connection = await prisma.slackConnection.findUnique({
      where: { userId },
    });
    if (!connection) {
      log.info(
        { senderId, window },
        "rate limit reached but no Slack connection; skipping notification",
      );
      return;
    }

    const windowStart = now.toISOString().slice(0, 13).replace("T", " ") + ":00 UTC";
    const windowEnd = new Date(now.getTime() + 3_600_000)
      .toISOString()
      .slice(0, 13)
      .replace("T", " ") + ":00 UTC";

    const text = [
      ":warning: *Email rate limit reached*",
      `Sender: \`${senderEmail}\``,
      `Limit: ${hourlyLimit} emails/hour`,
      `Window: ${windowStart} – ${windowEnd}`,
      "Additional emails have been rescheduled to the next hour window.",
    ].join("\n");

    // Prefer the incoming webhook (no token in the request path); fall
    // back to chat.postMessage with the stored bot token.
    const webhookUrl = connection.webhookUrl
      ? decryptToken(connection.webhookUrl)
      : null;

    let delivered = false;
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      delivered = response.ok;
    } else {
      const client = new WebClient(decryptToken(connection.accessToken));
      const result = await client.chat.postMessage({
        channel: connection.channelId ?? "",
        text,
      });
      delivered = Boolean(result.ok);
    }

    if (!delivered) throw new Error("Slack delivery failed");
    log.info({ senderId, window }, "Slack rate-limit notification sent");
  } catch (err) {
    // Never let a notification failure affect email processing.
    log.error({ err, senderId, window }, "slack notification failed");
  }
}
