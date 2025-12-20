import { Router } from "express";
import fs from "fs";
import ResourceProcessingController from "../controllers/resourceProcessing.controller.js";
import { authenticateUser } from "../middleware/auth.middleware.js";

const router = Router();
const resourceProcessingController = new ResourceProcessingController();

router.use(authenticateUser);

router.get("/get-all-images", async (req, res) => {
  const results = await resourceProcessingController.getAllImages(req.user!.id);
  res.json({ success: true, data: results });
});

router.get("/get-all-videos", async (req, res) => {
  const results = await resourceProcessingController.getAllVideos(req.user!.id);
  res.json({ success: true, data: results });
});

router.post("/upload-images", async (req, res) => {
  try {
    const { urls } = await req.body;

    const queueResult = await resourceProcessingController.queueImages(
      urls as string[],
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
});

router.get("/search-images", async (req, res) => {
  const { query } = req.query;
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "Search query is required" });
  }
  try {
    const results = await resourceProcessingController.searchImages(
      query,
      req.user!.id,
      "/api/media/search-images",
      req.method
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

// Video processing endpoints
router.post("/process-video", async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl || typeof videoUrl !== "string") {
      return res.status(400).json({
        success: false,
        error: "Video URL is required",
      });
    }

    // Queue the video for processing (async)
    const { jobId } = await resourceProcessingController.queueVideo(
      videoUrl,
      req.user!.id
    );

    res.json({
      success: true,
      message: "Video queued for processing",
      data: { jobId },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get video processing job status
router.get("/video-job-status/:jobId", async (req, res) => {
  const { jobId } = req.params;
  try {
    const status = await resourceProcessingController.getVideoJobStatus(jobId);
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

router.get("/search-videos", async (req, res) => {
  const { query, topK } = req.query;

  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const results = await resourceProcessingController.searchVideos(
      query,
      req.user!.id,
      topK ? parseInt(topK as string, 10) : 5
    );

    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download video segment
router.get("/download-video-segment", async (req, res) => {
  try {
    const { videoUrl, startTime, endTime } = req.query;

    if (!videoUrl || typeof videoUrl !== "string") {
      return res.status(400).json({
        success: false,
        error: "Video URL is required",
      });
    }

    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: "Start time and end time are required",
      });
    }

    const start = parseFloat(startTime as string);
    const end = parseFloat(endTime as string);

    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      return res.status(400).json({
        success: false,
        error: "Invalid start time or end time",
      });
    }

    // Extract video segment
    const segmentPath = await resourceProcessingController.extractVideoSegment(
      videoUrl,
      start,
      end
    );

    // Set headers for file download
    const filename = `video-segment-${start.toFixed(2)}-${end.toFixed(2)}.mp4`;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Stream the file
    const fileStream = fs.createReadStream(segmentPath);
    
    fileStream.pipe(res);

    // Clean up file after streaming
    fileStream.on("end", () => {
      try {
        fs.unlinkSync(segmentPath);
      } catch (error) {
        console.error("Error deleting segment file:", error);
      }
    });

    fileStream.on("error", (error: any) => {
      console.error("Error streaming segment file:", error);
      try {
        fs.unlinkSync(segmentPath);
      } catch (err) {
        console.error("Error deleting segment file:", err);
      }
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Failed to stream video segment" });
      }
    });
  } catch (error: any) {
    console.error("Error downloading video segment:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
