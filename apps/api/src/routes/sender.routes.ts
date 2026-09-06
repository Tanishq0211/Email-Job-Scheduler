import { Router } from "express";
import {
  listSenders,
  createSender,
  updateSender,
} from "../controllers/sender.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validation.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";
import { z } from "zod";

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(1).max(100),
  hourlyLimit: z.number().int().min(1).max(100_000).optional(),
  minDelayMs: z.number().int().min(0).max(3_600_000).optional(),
});

const updateSchema = createSchema.partial();

router.get("/", asyncHandler(listSenders));
router.post("/", validate({ body: createSchema }), asyncHandler(createSender));
router.patch(
  "/:id",
  validate({
    body: updateSchema,
    params: z.object({ id: z.string().uuid() }),
  }),
  asyncHandler(updateSender),
);

export default router;
