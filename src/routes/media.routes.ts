// TODO: Implement media routes
import { Router } from "express";
import { UploadsService } from "../services/uploads.service.ts";
import { TOTAL_UPLOAD_LIMIT } from "../utils/constants.js";
import ResourceProcessingController from "../controllers/resourceProcessing.controller.ts";
import { authenticateUser } from "../middleware/auth.middleware.ts";

const router = Router();
const resourceProcessingController = new ResourceProcessingController();
const uploadsService = new UploadsService();
const upload = uploadsService.getUpload();

router.use(authenticateUser);

router.get("/get-all-images", async (req, res) => {
  const results = await resourceProcessingController.getAllImages(req.user!.id);
  res.json({ success: true, data: results });
});

router.post(
  "/upload-images",
  upload.fields([{ name: "images", maxCount: TOTAL_UPLOAD_LIMIT }]),
  async (req, res) => {
    const files =
      (req.files as { images?: Express.Multer.File[] }).images ?? [];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No image files provided" });
    }
    try {
      const queueResult = await resourceProcessingController.queueImages(
        files,
        req.user!.id
      );

      res.json({
        success: true,
        message: "Images queued for processing",
        data: queueResult,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.get("/search-images", async (req, res) => {
  const { query } = req.query;
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "Search query is required" });
  }
  try {
    const results = await resourceProcessingController.searchImages(
      query,
      req.user!.id
    );
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/job-status/:jobId", async (req, res) => {
  const { jobId } = req.params;
  try {
    const status = await resourceProcessingController.getJobStatus(jobId);
    if (!status) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/queue-stats", async (req, res) => {
  try {
    const stats = await resourceProcessingController.getQueueStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
