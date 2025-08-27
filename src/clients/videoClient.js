import express from "express";
import multer from "multer";
import fs from "fs";
import { TwelveLabsService } from "../services/twelveLabsService.js";
import { VideoController } from "../controllers/videoController.js";
import dotenv from "dotenv";
import cors from "cors";
import { SupabaseService } from "../services/supabaseService.js";

dotenv.config();

export class VideoClient {
  constructor() {
    this.app = express();
    this.PORT = process.env.PORT || 4000;

    const API_KEY = process.env.TWELVE_LABS_API_KEY;
    if (!API_KEY) {
      console.error("TWELVE_LABS_API_KEY environment variable is required");
      process.exit(1);
    }

    this.app.use(cors({ origin: "*" }));
    this.service = new TwelveLabsService(API_KEY);
    this.supabaseService = new SupabaseService();
    this.controller = new VideoController(this.service);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupFileUpload() {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = "uploads/";
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
      },
    });

    return multer({
      storage,
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    });
  }

  setupRoutes() {
    const upload = this.setupFileUpload();

    this.app.post("/api/indexes", this.controller.createIndex);
    this.app.get("/api/indexes", this.controller.getIndexes);
    this.app.get("/api/indexes/:indexName", this.controller.getIndex);

    this.app.post(
      "/api/upload",
      upload.single("file"),
      this.controller.uploadVideo
    );

    this.app.post("/api/upload/bulk", this.controller.bulkUploadVideos);

    this.app.get("/api/tasks/:taskId", this.controller.getTask);
    this.app.get("/api/tasks", this.controller.getTasks);

    this.app.post("/api/search", this.controller.searchVideos);
    this.app.post("/api/search/advanced", this.controller.advancedSearch);

    this.app.get("/api/video/chapters", this.controller.getVideoChapters);

    this.app.post(
      "/api/video/generate",
      this.controller.generateVideoFromChapters
    );

    this.app.get("/api/videos/:videoId", this.controller.getVideo);
    this.app.get("/api/videos", this.controller.getVideos);
    this.app.put("/api/videos/:videoId", this.controller.updateVideo);
    this.app.delete("/api/videos/:videoId", this.controller.deleteVideo);

    this.app.post(
      "/api/videos/:videoId/summarize",
      this.controller.summarizeVideo
    );
    this.app.post("/api/videos/:videoId/text", this.controller.generateText);

    this.app.get("/api/supabase/get-video", async (req, res) => {
      const { videoId } = req.query;
      console.log("Supabase route hit", videoId);
      const video = await this.supabaseService.getVideoById(String(videoId));
      res.json({ success: true, data: video });
    });

    this.app.get("/api/supabase/get-videos", async (req, res) => {
      const { videoIds } = req.query;
      console.log("Supabase route hit", videoIds);
      const videos = await this.supabaseService.getVideosByIds(
        videoIds.split(",")
      );
      res.json({ success: true, data: videos });
    });

    this.app.get("/health", (req, res) => {
      res.json({
        success: true,
        message: "Twelve Labs Video Service is running",
        timestamp: new Date().toISOString(),
      });
    });
  }

  setupErrorHandling() {
    this.app.use((error, req, res, next) => {
      console.error("Unhandled error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    });
  }

  start() {
    this.app.listen(this.PORT, () => {
      console.log(`Twelve Labs Video Service running on port ${this.PORT}`);
      console.log(`Health check: http://localhost:${this.PORT}/health`);
    });
  }
}
