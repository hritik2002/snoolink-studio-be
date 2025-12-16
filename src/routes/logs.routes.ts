import { Router } from "express";
import logsController from "../controllers/logs.controller.js";
import { authenticateUser } from "../middleware/auth.middleware.js";

const router = Router();

// All log routes require authentication
router.use(authenticateUser);

// Get all logs with optional filtering
router.get("/", async (req, res) => {
  await logsController.getLogs(req, res);
});

// Get log statistics
router.get("/stats", async (req, res) => {
  await logsController.getLogStats(req, res);
});

export default router;

