import { Router } from "express";
import { health, readiness } from "../controllers/health.controller.js";
import { asyncHandler } from "../utils/async-handler.js";

const router = Router();

router.get("/", health);
router.get("/ready", asyncHandler(readiness));

export default router;
