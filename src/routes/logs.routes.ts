import { Router } from "express";
import logsController from "../controllers/logs.controller.js";

const router = Router();

// Log routes are publicly accessible (no authentication required)

// Get all logs with optional filtering
router.get("/", async (req, res) => {
  await logsController.getLogs(req, res);
});

// Get log statistics
router.get("/stats", async (req, res) => {
  await logsController.getLogStats(req, res);
});

export default router;

