import { Router } from "express";
import { z } from "zod";
import {
  scheduleEmails,
  listScheduled,
  listSent,
  getEmail,
  search,
  listQuerySchema,
  searchQuerySchema,
} from "../controllers/email.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validation.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ScheduleRequestSchema } from "@reachinbox/shared";

const router = Router();
router.use(requireAuth);

router.post(
  "/schedule",
  validate({ body: ScheduleRequestSchema }),
  asyncHandler(scheduleEmails),
);
router.get("/scheduled", validate({ query: listQuerySchema }), asyncHandler(listScheduled));
router.get("/sent", validate({ query: listQuerySchema }), asyncHandler(listSent));
router.get("/search", validate({ query: searchQuerySchema }), asyncHandler(search));
router.get(
  "/:id",
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(getEmail),
);

export default router;
