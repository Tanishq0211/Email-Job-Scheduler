import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.middleware.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { errorMiddleware, notFoundHandler } from "./middleware/error.middleware.js";
import { googleAuthRouter, sessionRouter } from "./routes/auth.routes.js";
import emailRoutes from "./routes/email.routes.js";
import senderRoutes from "./routes/sender.routes.js";
import { slackAuthRouter, slackApiRouter } from "./routes/slack.routes.js";
import healthRoutes from "./routes/health.routes.js";
import { emailQueue } from "./queues/connection.js";

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers["x-request-id"] as string,
      autoLogging: {
        ignore: (req) => req.url === "/health" || req.url === "/health/ready",
      },
    }),
  );

  // Health first (no auth)
  app.use("/health", healthRoutes);

  // Auth + OAuth flows
  app.use("/auth", googleAuthRouter);
  app.use("/auth/slack", slackAuthRouter);

  // Protected API
  app.use("/api/auth", sessionRouter);
  app.use("/api/emails", emailRoutes);
  app.use("/api/senders", senderRoutes);
  app.use("/api/slack", slackApiRouter);

  // Bull Board — session-protected, never anonymous.
  const boardAdapter = new ExpressAdapter();
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter: boardAdapter,
  });
  boardAdapter.setBasePath("/admin/queues");
  app.use(
    "/admin/queues",
    requireAuth,
    boardAdapter.getRouter(),
  );

  app.use(notFoundHandler);
  app.use(errorMiddleware);

  return app;
}
