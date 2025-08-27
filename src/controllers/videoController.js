import fs from "fs";
import path from "path";
import uploadVideoToCloudinary from "../services/cloudinaryService.js";
import { SupabaseService } from "../services/supabaseService.js";

export class VideoController {
  constructor(service) {
    this.service = service;
    this.supabaseService = new SupabaseService();
  }

  // Index endpoints
  createIndex = async (req, res) => {
    try {
      const { name, engines } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Index name is required" });
      }

      const index = await this.service.createIndex(name, engines);
      res.json({ success: true, data: index });
    } catch (error) {
      this.handleError(res, error, "Create index error");
    }
  };

  getIndexes = async (req, res) => {
    try {
      const indexes = await this.service.getIndexes();
      res.json({ success: true, data: indexes });
    } catch (error) {
      this.handleError(res, error, "List indexes error");
    }
  };

  getIndex = async (req, res) => {
    try {
      const { indexName } = req.params;
      const index = await this.service.getIndex(indexName);
      res.json({ success: true, data: index });
    } catch (error) {
      this.handleError(res, error, "Get index error");
    }
  };

  bulkUploadVideos = async (req, res) => {
    try {
      const folderPath = path.resolve("./bulk-upload-videos");

      const files = fs
        .readdirSync(folderPath)
        .filter((f) => f.match(/\.(mp4|mov|avi|mkv)$/i));

      if (files.length === 0) {
        return res
          .status(400)
          .json({ error: "No video files found in folder" });
      }

      const uploadPromises = files.map(async (fileName) => {
        const filePath = path.join(folderPath, fileName);

        const videoUrl = await uploadVideoToCloudinary(filePath);

        const result = await this.service.uploadVideo({
          videoUrl,
          indexId: process.env.TWELVE_LABS_INDEX_ID,
          language: "en",
        });

        await this.supabaseService.insertVideo({
          twelveLabsVideoId: result.videoData.id,
          videoUrl: videoUrl,
        });

        return {
          fileName,
          videoUrl: result.videoData.videoUrl,
          taskId: result.taskId,
          videoId: result.videoId,
          status: result.status,
        };
      });

      // Run in parallel
      const results = await Promise.allSettled(uploadPromises);

      return res.status(200).json({
        success: true,
        message: "Bulk upload completed",
        count: results.length,
        data: results,
      });
    } catch (error) {
      this.handleError(res, error, "Bulk upload error");
    }
  };

  sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  // Upload endpoint
  uploadVideo = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No video file provided" });
      }

      const videoUrl = await uploadVideoToCloudinary(req.file.path);

      const result = await this.service.uploadVideo({
        videoUrl,
        indexId: process.env.TWELVE_LABS_INDEX_ID,
        language: "en",
      });

      await this.supabaseService.insertVideo({
        twelveLabsVideoId: result.videoData.id,
        videoUrl: videoUrl,
      });

      return res.status(200).json({
        success: true,
        message: "Video uploaded successfully",
        data: {
          videoUrl: result.videoData.videoUrl,
        },
      });
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      this.handleError(res, error, "Upload error");
    }
  };

  getTask = async (req, res) => {
    try {
      const { taskId } = req.params;
      const task = await this.service.getTask(taskId);
      res.json({ success: true, data: task });
    } catch (error) {
      this.handleError(res, error, "Get task error");
    }
  };

  getTasks = async (req, res) => {
    try {
      const tasks = await this.service.getTasks();
      res.json({ success: true, data: tasks });
    } catch (error) {
      this.handleError(res, error, "List tasks error");
    }
  };

  getVideoChapters = async (req, res) => {
    try {
      const { videoId } = req.query;

      if (!videoId) {
        return res.status(400).json({ error: "Video ID is required" });
      }

      const gist = await this.service.analyzeVideo(videoId);
      res.json({ success: true, data: gist });
    } catch (error) {
      this.handleError(res, error, "Generate gist error");
    }
  };

  generateVideoFromChapters = async (req, res) => {
    try {
      const { chapters } = req.body;

      const results = await Promise.allSettled(
        chapters.map((chapter) => {
          const searchParams = {
            indexId: process.env.TWELVE_LABS_INDEX_ID,
            query: chapter.description,
            searchOptions: ["visual", "audio"],
            threshold: "medium",
            maxResults: 10,
            sortOption: "score",
            sortBy: "score",
          };

          return this.service.searchVideos(searchParams);
        })
      );

      const videos = results.map((r) =>
        r.status === "fulfilled" ? r.value : null
      );

      res.json({ success: true, data: videos });
    } catch (error) {
      this.handleError(res, error, "Generate video error");
    }
  };

  searchVideos = async (req, res) => {
    try {
      const {
        indexId = process.env.TWELVE_LABS_INDEX_ID,
        query,
        searchOptions = ["visual", "audio"],
        threshold = "medium",
        maxResults = 10,
        sortOption = "score",
        sortBy = "score",
      } = req.body;

      if (!indexId || !query) {
        return res
          .status(400)
          .json({ error: "Index ID and search query are required" });
      }

      const searchParams = {
        indexId,
        query,
        options: searchOptions,
        threshold,
        maxResults,
        sortOption,
        sortBy,
      };

      const results = await this.service.searchVideos(searchParams);

      res.json({
        success: true,
        query,
        searchOptions,
        totalResults: results.length,
        data: results,
      });
    } catch (error) {
      this.handleError(res, error, "Search error");
    }
  };

  advancedSearch = async (req, res) => {
    try {
      const searchParams = req.body;
      if (!searchParams.indexId || !searchParams.query) {
        return res
          .status(400)
          .json({ error: "Index ID and search query are required" });
      }

      const results = await this.service.searchVideos(searchParams);
      res.json({
        success: true,
        searchParams,
        totalResults: results.length,
        data: results,
      });
    } catch (error) {
      this.handleError(res, error, "Advanced search error");
    }
  };

  getVideo = async (req, res) => {
    try {
      const { videoId } = req.params;
      const video = await this.service.getVideo(videoId);
      res.json({ success: true, data: video });
    } catch (error) {
      this.handleError(res, error, "Get video error");
    }
  };

  getVideos = async (req, res) => {
    try {
      const { indexId } = req.query;
      const videos = await this.service.getVideos(indexId);
      res.json({
        success: true,
        count: videos.length,
        data: videos,
      });
    } catch (error) {
      this.handleError(res, error, "List videos error");
    }
  };

  updateVideo = async (req, res) => {
    try {
      const { videoId } = req.params;
      const updateData = req.body;
      const updatedVideo = await this.service.updateVideo(videoId, updateData);
      res.json({ success: true, data: updatedVideo });
    } catch (error) {
      this.handleError(res, error, "Update video error");
    }
  };

  deleteVideo = async (req, res) => {
    try {
      const { videoId } = req.params;
      await this.service.deleteVideo(videoId);
      res.json({ success: true, message: "Video deleted successfully" });
    } catch (error) {
      this.handleError(res, error, "Delete video error");
    }
  };

  summarizeVideo = async (req, res) => {
    try {
      const { videoId } = req.params;
      const { type } = req.body;
      const summary = await this.service.summarizeVideo(videoId, type);
      res.json({ success: true, data: summary });
    } catch (error) {
      this.handleError(res, error, "Summarize video error");
    }
  };

  generateText = async (req, res) => {
    try {
      const { videoId } = req.params;
      const text = await this.service.generateText(videoId);
      res.json({ success: true, data: text });
    } catch (error) {
      this.handleError(res, error, "Generate text error");
    }
  };

  handleError(res, error, logMessage) {
    console.error(logMessage, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
