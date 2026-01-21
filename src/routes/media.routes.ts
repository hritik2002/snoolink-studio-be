import { Router } from "express";
import fs from "fs";
import ResourceProcessingController from "../controllers/resourceProcessing.controller.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { analyticsService } from "../services/analytics.service.js";

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

/**
 * GET /api/media/resources
 * Paginated endpoint for fetching resources (images and videos)
 * Query params: collection, type, limit, offset
 */
router.get("/resources", async (req, res) => {
  try {
    const { collection, type, limit, offset } = req.query;
    
    const results = await resourceProcessingController.getResourcesPaginated(
      req.user!.id,
      {
        collectionName: collection as string | undefined,
        resourceType: type as "image" | "video" | undefined,
        limit: limit ? parseInt(limit as string, 10) : 20,
        offset: offset ? parseInt(offset as string, 10) : 0,
      }
    );
    
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/upload-images", async (req, res) => {
  try {
    const { urls, collectionName = "Default" } = req.body;
    const arr = Array.isArray(urls) ? urls : [];
    const queueResult = await resourceProcessingController.queueImages(
      arr,
      req.user!.id,
      collectionName
    );
    analyticsService.track(req.user!.id, "upload_queued", { type: "image", count: arr.length, collectionName }, "server");
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
  const { query, collection, expandQuery: expandQueryParam } = req.query;
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "Search query is required" });
  }
  const expandQuery = expandQueryParam !== "false" && expandQueryParam !== "0";
  const collectionName = (collection as string) || "Default";
  try {
    const results = await resourceProcessingController.searchImages(
      query,
      req.user!.id,
      "/api/media/search-images",
      req.method,
      collectionName,
      expandQuery
    );
    const data = results as { results?: unknown[]; expandedQuery?: string | null };
    const resultCount = data?.results?.length ?? 0;
    const rawQuery = String(query).trim().slice(0, 2000);
    const expanded = data.expandedQuery != null ? String(data.expandedQuery).slice(0, 2000) : null;
    analyticsService.track(req.user!.id, "search_completed_image", { result_count: resultCount, collection: collectionName, user_query: rawQuery, expanded_query: expanded }, "server");
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error",
    });
  }
});

/**
 * GET /api/media/search
 * Search across multiple collections
 * Query params:
 *   - query: Search query (required)
 *   - collections: Comma-separated collection names or "all" (required)
 *   - topK: Number of results (optional, default 10)
 */
router.get("/search", async (req, res) => {
  const { query, collections, topK, expandQuery: expandQueryParam } = req.query;
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({
      success: false,
      error: "Search query is required",
    });
  }
  if (!collections || typeof collections !== "string") {
    return res.status(400).json({
      success: false,
      error: "Collections parameter is required (comma-separated names or 'all')",
    });
  }
  const expandQuery = expandQueryParam !== "false" && expandQueryParam !== "0";
  try {
    const userId = req.user!.id;
    let collectionNames: string[];

    if (collections.toLowerCase() === "all") {
      const supabaseService = new (await import("../services/supabaseService")).SupabaseService();
      const userCollections = await supabaseService.getCollections(userId);
      collectionNames = userCollections.map((c) => c.name);
      if (collectionNames.length === 0) {
        return res.json({
          success: true,
          data: { results: [], expandedQuery: null, collectionsSearched: [] },
        });
      }
    } else {
      collectionNames = collections.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
      if (collectionNames.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one collection name is required",
        });
      }
      if (collectionNames.length > 3) {
        return res.status(400).json({
          success: false,
          error: "Maximum 3 collections can be searched at once",
        });
      }
    }

    const results = await resourceProcessingController.searchMultipleCollections(
      query,
      userId,
      collectionNames,
      topK ? parseInt(topK as string, 10) : 10,
      "/api/media/search",
      req.method,
      expandQuery
    );
    const data = results as { results?: unknown[]; expandedQuery?: string | null };
    const resultCount = data?.results?.length ?? 0;
    const rawQuery = String(query).trim().slice(0, 2000);
    const expanded = data.expandedQuery != null ? String(data.expandedQuery).slice(0, 2000) : null;
    analyticsService.track(userId, "search_completed_multi", { result_count: resultCount, collection_count: collectionNames.length, user_query: rawQuery, expanded_query: expanded }, "server");
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error",
    });
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

// Get user-specific job counts
router.get("/user-job-counts", async (req, res) => {
  try {
    const counts = await resourceProcessingController.getUserJobCounts(
      req.user!.id
    );
    res.json({ success: true, data: counts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user-specific image job counts
router.get("/user-image-job-counts", async (req, res) => {
  try {
    const counts = await resourceProcessingController.getUserImageJobCounts(
      req.user!.id
    );
    res.json({ success: true, data: counts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user-specific video job counts
router.get("/user-video-job-counts", async (req, res) => {
  try {
    const counts = await resourceProcessingController.getUserVideoJobCounts(
      req.user!.id
    );
    res.json({ success: true, data: counts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user's processing and failed videos
router.get("/user-processing-failed-videos", async (req, res) => {
  try {
    const videos = await resourceProcessingController.getUserProcessingAndFailedVideos(
      req.user!.id
    );
    res.json({ success: true, data: videos });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user's processing and failed images
router.get("/user-processing-failed-images", async (req, res) => {
  try {
    const images = await resourceProcessingController.getUserProcessingAndFailedImages(
      req.user!.id
    );
    res.json({ success: true, data: images });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove failed video jobs
router.post("/remove-failed-videos", async (req, res) => {
  try {
    const { jobIds } = req.body;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "jobIds array is required",
      });
    }
    const removedCount = await resourceProcessingController.removeFailedVideoJobs(
      req.user!.id,
      jobIds
    );
    res.json({
      success: true,
      message: `Successfully removed ${removedCount} failed video${removedCount !== 1 ? "s" : ""}`,
      data: { removedCount },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Re-queue failed videos
router.post("/requeue-failed-videos", async (req, res) => {
  try {
    const { jobIds } = req.body;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "jobIds array is required",
      });
    }
    const results = await resourceProcessingController.requeueFailedVideos(
      req.user!.id,
      jobIds
    );
    res.json({
      success: true,
      message: `Re-queued ${results.length} failed video(s)`,
      data: { results },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Video processing endpoints
router.post("/process-video", async (req, res) => {
  try {
    const { videoUrl, collectionName = "Default" } = req.body;

    if (!videoUrl || typeof videoUrl !== "string") {
      return res.status(400).json({
        success: false,
        error: "Video URL is required",
      });
    }

    // Queue the video for processing (async)
    const { jobId } = await resourceProcessingController.queueVideo(
      videoUrl,
      req.user!.id,
      collectionName
    );
    analyticsService.track(req.user!.id, "upload_queued", { type: "video", count: 1, collectionName }, "server");
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

/**
 * GET /api/media/search-videos-collections
 * Search videos across multiple collections
 * Query params:
 *   - query: Search query (required)
 *   - collections: Comma-separated collection names or "all" (required)
 *   - topK: Number of results (optional, default 10)
 */
router.get("/search-videos-collections", async (req, res) => {
  const { query, collections, topK, expandQuery: expandQueryParam } = req.query;
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({
      success: false,
      error: "Search query is required",
    });
  }
  if (!collections || typeof collections !== "string") {
    return res.status(400).json({
      success: false,
      error: "Collections parameter is required (comma-separated names or 'all')",
    });
  }
  const expandQuery = expandQueryParam !== "false" && expandQueryParam !== "0";
  try {
    const userId = req.user!.id;
    let collectionNames: string[];

    if (collections.toLowerCase() === "all") {
      const supabaseService = new (await import("../services/supabaseService")).SupabaseService();
      const userCollections = await supabaseService.getCollections(userId);
      collectionNames = userCollections.map((c) => c.name);
      if (collectionNames.length === 0) {
        return res.json({
          success: true,
          data: { results: [], expandedQuery: null, collectionsSearched: [] },
        });
      }
    } else {
      collectionNames = collections.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
      if (collectionNames.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one collection name is required",
        });
      }
      if (collectionNames.length > 3) {
        return res.status(400).json({
          success: false,
          error: "Maximum 3 collections can be searched at once",
        });
      }
    }

    const results = await resourceProcessingController.searchVideosMultipleCollections(
      query,
      userId,
      collectionNames,
      topK ? parseInt(topK as string, 10) : 10,
      "/api/media/search-videos-collections",
      req.method,
      expandQuery
    );
    const data = results as { results?: Record<string, unknown>; expandedQuery?: string | null };
    const videoCount = data?.results && typeof data.results === "object" ? Object.keys(data.results).length : 0;
    const rawQuery = String(query).trim().slice(0, 2000);
    const expanded = data.expandedQuery != null ? String(data.expandedQuery).slice(0, 2000) : null;
    analyticsService.track(userId, "search_completed_video", { video_count: videoCount, collection_count: collectionNames.length, user_query: rawQuery, expanded_query: expanded }, "server");
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "Internal server error" });
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
      } catch {
        // Ignore cleanup errors
      }
    });

    fileStream.on("error", () => {
      try {
        fs.unlinkSync(segmentPath);
      } catch {
        // Ignore cleanup errors
      }
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Failed to stream video segment" });
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
