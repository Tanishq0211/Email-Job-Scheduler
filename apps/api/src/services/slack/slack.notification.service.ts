import { WebClient } from "@slack/web-api";
import { slackAlertKey, utcHourWindow } from "@reachinbox/shared";
import type Redis from "ioredis";
import { prisma } from "../../db/prisma.js";
import { childLogger } from "../../utils/logger.js";
import { decryptToken } from "./slack.oauth.service.js";

const log = childLogger({ operation: "slack.notify" });

/**
 * Notify the connected Slack workspace that a sender hit its hourly
 * rate limit. Semantics:
 *
 *  1. No Slack connection → no-op. The dedup key is NOT created, so a
 *     later rate-limit event in the same hour can still notify once the
 *     user connects Slack.
 *  2. Exactly one alert per (sender, UTC hour window): the alert is
 *     reserved atomically with Redis SET NX before delivery.
 *  3. Delivery failure releases the reservation, allowing the next
 *     rate-limit event to retry within the same hour.
 *  4. Slack problems never affect email processing: errors are logged
 *     and swallowed.
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
  const dedupKey = slackAlertKey(senderId, window);

  let reserved = false;
  try {
    // 1. Connection check first — no connection must not consume the
    // one-alert-per-hour reservation.
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

    // 2. Atomic exactly-one reservation per sender + window.
    const reservedResult = await redis.set(dedupKey, "1", "EX", 3600, "NX");
    if (reservedResult !== "OK") return; // alert already sent this window
    reserved = true;

    const windowStart =
      now.toISOString().slice(0, 13).replace("T", " ") + ":00 UTC";
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

    // 3. Deliver: prefer the incoming webhook (no token in the request
    // path); fall back to chat.postMessage with the stored bot token.
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

    if (!delivered) {
      // 4. Release the reservation so a later rate-limit event in this
      // hour can retry the notification.
      await redis.del(dedupKey);
      reserved = false;
      log.warn(
        { senderId, window },
        "slack delivery failed; alert reservation released for retry",
      );
      return;
    }

    log.info({ senderId, window }, "Slack rate-limit notification sent");
  } catch (err) {
    // 5. Never let a notification failure affect email processing.
    log.error({ err, senderId, window }, "slack notification failed");
    if (reserved) {
      try {
        await redis.del(dedupKey);
      } catch {
        // Redis unavailable — the key expires on its own (1h TTL).
      }
    }
  }
}
