import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../config/env.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ operation: "smtp" });

export interface SendEmailInput {
  fromAddress: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | null;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password },
    });
  }
  return transporter;
}

/** Send via the configured SMTP transport (Ethereal). Returns the SMTP
 * message id and — for Ethereal — a preview URL for demos. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const info = await getTransporter().sendMail({
    from: `"${input.fromName}" <${input.fromAddress}>`,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  log.info(
    { messageId: info.messageId, to: input.to },
    "email sent via SMTP",
  );

  return {
    messageId: info.messageId,
    // getTestMessageUrl returns false when not an Ethereal transport
    previewUrl: typeof previewUrl === "string" ? previewUrl : null,
  };
}

export async function verifySmtp(): Promise<void> {
  await getTransporter().verify();
}

export async function closeSmtp(): Promise<void> {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
}
