import { ResourceProcessingService } from "../services/resrouceProcessing.service";
import { UploadsService } from "../services/uploads.service";
import { SupabaseService } from "../services/supabaseService";
import { imageQueueService } from "../services/imageQueue.service";
import { videoQueueService } from "../services/videoQueue.service";
import { loggingService } from "../services/logging.service";
import { VideoProcessingService } from "../services/videoProcessing.service";
import { redisService } from "../services/redis.service";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

class ResourceProcessingController {
  private resourceProcessingService: ResourceProcessingService;
  private uploadsService: UploadsService;
  private supabaseService: SupabaseService;
  private videoProcessingService: VideoProcessingService;
  constructor() {
    this.resourceProcessingService = new ResourceProcessingService();
    this.uploadsService = new UploadsService();
    this.supabaseService = new SupabaseService();
    this.videoProcessingService = new VideoProcessingService();
  }

  async upsertImages(imagePaths: Express.Multer.File[], userId: string) {
    const promises = imagePaths.map(async (image) => {
      try {
        const { fileUrl } = await this.uploadsService.handleFileUpload(
          image.path,
          "image"
        );
        const description = await this.resourceProcessingService.describeImage(
          fileUrl,
          userId,
          { endpoint: "/api/media/upload-image", resourceType: "image" }
        );
        const id = await this.resourceProcessingService.embedImage({
          description,
          imageUrl: fileUrl,
          userId,
        });

        return {
          success: true,
          data: {
            id,
            description,
            imageUrl: fileUrl,
          },
          error: null,
        };
      } catch (error: any) {
        console.error(
          `Error processing image ${image.originalname || image.filename}:`,
          error
        );
        return {
          success: false,
          data: null,
          error: {
            message: error?.message || "Unknown error occurred",
            code: error?.code || "processing_error",
            filename: image.originalname || image.filename,
          },
        };
      }
    });

    const results = await Promise.allSettled(promises);

    // Extract results and handle any unexpected promise rejections
    const processedResults = results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        // This should rarely happen since we catch errors inside the promise
        console.error(
          `Unexpected rejection for image at index ${index}:`,
          result.reason
        );
        return {
          success: false,
          data: null,
          error: {
            message: result.reason?.message || "Unexpected error occurred",
            code: result.reason?.code || "unexpected_error",
            filename:
              imagePaths[index]?.originalname ||
              imagePaths[index]?.filename ||
              "unknown",
          },
        };
      }
    });

    const successful = processedResults.filter((r) => r.success);
    const failed = processedResults.filter((r) => !r.success);

    if (failed.length > 0) {
      console.error("Failed images:", failed);
    }

    // await this.supabaseService.postImages(successful.map(r => r.data), userId);

    return {
      successful: successful.map((r) => r.data),
      failed: failed.map((r) => r.error),
      total: imagePaths.length,
      successCount: successful.length,
      failureCount: failed.length,
    };
  }

  async getAllImages(userId: string) {
    const images = await this.supabaseService.getImages(userId);
    return images;
  }

  async getAllVideos(userId: string) {
    const videos = await this.supabaseService.getVideos(userId);
    return videos;
  }

  async getResourcesPaginated(
    userId: string,
    options: {
      collectionName?: string;
      resourceType?: "image" | "video";
      limit?: number;
      offset?: number;
    } = {}
  ) {
    return await this.supabaseService.getResourcesPaginated(userId, options);
  }

  /**
   * Generate cache key for search queries
   */
  private getSearchCacheKey(
    userId: string,
    query: string,
    collections: string[],
    topK: number,
    type: "image" | "video"
  ): string {
    // Sort collections to ensure consistent cache key
    const sortedCollections = [...collections].sort().join(",");
    // Create hash of query to keep key length manageable
    const queryHash = crypto
      .createHash("md5")
      .update(query.toLowerCase().trim())
      .digest("hex")
      .substring(0, 16);
    return `search:${type}:${userId}:${queryHash}:${sortedCollections}:${topK}`;
  }

  async searchImages(
    query: string,
    userId: string,
    endpoint: string = "/api/media/search-images",
    method: string = "GET"
  ) {
    const startTime = Date.now();
    let expandedQuery: string | null = null;
    let results: any = null;
    let error: string | null = null;

    try {
      expandedQuery = await this.resourceProcessingService.expandQuery(
        `User Query: "${query}"
        Expanded:`,
        userId,
        endpoint
      );

      // Check cache first
      const cacheKey = this.getSearchCacheKey(
        userId,
        expandedQuery,
        ["Default"],
        5,
        "image"
      );
      const cached = await redisService.get<any>(cacheKey);
      if (cached) {
        console.log(`Cache hit for image search: ${cacheKey}`);
        return cached;
      }

      results = await this.resourceProcessingService.searchImages({
        query: expandedQuery,
        userId,
      });

      const response = {
        results,
        expandedQuery,
        collectionsSearched: ["Default"],
      };

      // Cache the results (15 minutes TTL for search results)
      await redisService.set(cacheKey, response, 900);

      const responseTime = Date.now() - startTime;

      // Log the request asynchronously (fire-and-forget)
      loggingService.logRequest({
        user_id: userId,
        user_query: query,
        enhanced_query: expandedQuery,
        response: response,
        error: null,
        endpoint,
        method,
        response_time_ms: responseTime,
      });

      return response;
    } catch (err: any) {
      error = err?.message || "Unknown error occurred";
      const responseTime = Date.now() - startTime;

      // Log the error asynchronously (fire-and-forget)
      loggingService.logRequest({
        user_id: userId,
        user_query: query,
        enhanced_query: expandedQuery,
        response: null,
        error: error,
        endpoint,
        method,
        response_time_ms: responseTime,
      });

      throw err;
    }
  }

  /**
   * Search across multiple collections
   * @param query - Search query
   * @param userId - User ID
   * @param collections - Array of collection names to search in
   * @param topK - Number of results per collection (default 5)
   */
  async searchMultipleCollections(
    query: string,
    userId: string,
    collections: string[],
    topK: number = 5,
    endpoint: string = "/api/media/search",
    method: string = "GET"
  ) {
    const startTime = Date.now();
    let expandedQuery: string | null = null;
    let results: any = null;
    let error: string | null = null;

    try {
      expandedQuery = await this.resourceProcessingService.expandQuery(
        `User Query: "${query}"
        Expanded:`,
        userId,
        endpoint
      );

      // Check cache first
      const cacheKey = this.getSearchCacheKey(
        userId,
        query,
        collections,
        topK,
        "image"
      );
      const cached = await redisService.get<any>(cacheKey);
      if (cached) {
        console.log(`Cache hit for image search: ${cacheKey}`);
        return cached;
      }

      results = await this.resourceProcessingService.searchMultipleCollections({
        query: expandedQuery,
        userId,
        collections,
        topK,
      });

      const response = {
        results,
        expandedQuery,
        collectionsSearched: collections,
      };

      // Cache the results (15 minutes TTL for search results)
      await redisService.set(cacheKey, response, 900);

      const responseTime = Date.now() - startTime;

      // Log the request asynchronously (fire-and-forget)
      loggingService.logRequest({
        user_id: userId,
        user_query: query,
        enhanced_query: expandedQuery,
        response: response,
        error: null,
        endpoint,
        method,
        response_time_ms: responseTime,
      });

      return response;
    } catch (err: any) {
      error = err?.message || "Unknown error occurred";
      const responseTime = Date.now() - startTime;

      // Log the error asynchronously (fire-and-forget)
      loggingService.logRequest({
        user_id: userId,
        user_query: query,
        enhanced_query: expandedQuery,
        response: null,
        error: error,
        endpoint,
        method,
        response_time_ms: responseTime,
      });

      throw err;
    }
  }

  async queueImages(
    imageUrls: string[],
    userId: string,
    collectionName: string = "Default"
  ): Promise<{ jobId: string; totalImages: number; queuedJobs: string[] }> {
    const jobId = uuidv4();
    const jobs = imageUrls.map((imageUrl) => ({
      imageUrl,
      userId,
      jobId,
      collectionName,
    }));

    const queuedJobs = await imageQueueService.addBulkImageJobs(jobs);

    return {
      jobId,
      totalImages: imageUrls.length,
      queuedJobs: queuedJobs.map((job) => job.id || ""),
    };
  }

  async getJobStatus(jobId: string) {
    const job = await imageQueueService.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await imageQueueService.getJobState(jobId);
    return state;
  }

  async getQueueStats() {
    const counts = await imageQueueService.getJobCounts();
    return counts;
  }

  /**
   * Get image processing job counts for a specific user
   */
  async getUserImageJobCounts(userId: string) {
    return await imageQueueService.getUserJobCounts(userId);
  }

  /**
   * Get video processing job counts for a specific user
   */
  async getUserVideoJobCounts(userId: string) {
    return await videoQueueService.getUserJobCounts(userId);
  }

  /**
   * Get combined job counts for both image and video processing for a specific user
   */
  async getUserJobCounts(userId: string) {
    const [imageCounts, videoCounts] = await Promise.all([
      imageQueueService.getUserJobCounts(userId),
      videoQueueService.getUserJobCounts(userId),
    ]);

    return {
      images: imageCounts,
      videos: videoCounts,
      total: {
        failed: imageCounts.failed + videoCounts.failed,
        inProgress: imageCounts.inProgress + videoCounts.inProgress,
      },
    };
  }

  /**
   * Get processing and failed videos for a specific user
   */
  async getUserProcessingAndFailedVideos(userId: string) {
    return await videoQueueService.getUserProcessingAndFailedVideos(userId);
  }

  /**
   * Get processing and failed images for a specific user
   */
  async getUserProcessingAndFailedImages(userId: string) {
    return await imageQueueService.getUserProcessingAndFailedImages(userId);
  }

  /**
   * Queue a video for processing (async)
   */
  async queueVideo(
    videoUrl: string,
    userId: string,
    collectionName: string = "Default"
  ): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const job = await videoQueueService.addVideoJob({
      videoUrl,
      userId,
      jobId,
      collectionName,
    });

    return {
      jobId: job.id || jobId,
    };
  }

  /**
   * Get video processing job status
   */
  async getVideoJobStatus(jobId: string) {
    const state = await videoQueueService.getJobState(jobId);
    if (!state) {
      return null;
    }
    return state;
  }

  /**
   * Process and index a video from URL (synchronous - used by worker)
   */
  async processVideo(videoUrl: string, userId: string) {
    try {
      const result = await this.videoProcessingService.processAndIndexVideo(
        videoUrl,
        userId
      );
      return result;
    } catch (error: any) {
      console.error("Error processing video:", error);
      throw new Error(`Failed to process video: ${error.message}`);
    }
  }

  /**
   * Search for video clips by text query
   */
  async searchVideos(
    query: string,
    userId: string,
    topK: number = 5
  ): Promise<
    Array<{
      id: string;
      score: number;
      text: string;
      videoUrl?: string;
      startTime?: string;
      endTime?: string;
    }>
  > {
    return await this.videoProcessingService.searchVideos(query, userId, topK);
  }

  /**
   * Search videos across multiple collections
   */
  async searchVideosMultipleCollections(
    query: string,
    userId: string,
    collections: string[],
    topK: number = 10,
    endpoint: string = "/api/media/search-videos",
    method: string = "GET"
  ) {
    const startTime = Date.now();
    let expandedQuery: string | null = null;
    let results: any = null;
    let error: string | null = null;

    try {
      const cacheKey = this.getSearchCacheKey(
        userId,
        query,
        collections,
        topK,
        "video"
      );
      const cached = await redisService.get<any>(cacheKey);
      if (cached) {
        return cached;
      }

      expandedQuery = await this.resourceProcessingService.expandQuery(
        `User Query: "${query}"
        Expanded:`,
        userId,
        endpoint
      );

      const groupedResults =
        await this.videoProcessingService.searchVideosMultipleCollections(
          expandedQuery,
          userId,
          collections,
          topK
        );

      // Enrich results with video metadata from database
      // groupedResults is now an object with videoUrl as keys
      const enrichedResults: Record<string, any> = {};

      for (const [videoUrl, videoResult] of Object.entries(groupedResults)) {
        try {
          // Fetch video metadata from database
          const videoMetadata =
            await this.supabaseService.getVideoMetadataByUrl(userId, videoUrl);

          enrichedResults[videoUrl] = {
            ...videoResult,
            videoId: videoMetadata?.id,
            title: this.extractVideoTitle(videoUrl),
            duration: videoMetadata?.duration,
            resolution: videoMetadata?.resolution,
          };
        } catch (error) {
          console.error(
            `Error fetching metadata for video ${videoUrl}:`,
            error
          );
          // Return result without metadata if fetch fails
          enrichedResults[videoUrl] = {
            ...videoResult,
            title: this.extractVideoTitle(videoUrl),
          };
        }
      }

      const response = {
        results: enrichedResults,
        expandedQuery,
        collectionsSearched: collections,
      };

      // Cache the results (15 minutes TTL for search results)
      await redisService.set(cacheKey, response, 900);

      const responseTime = Date.now() - startTime;

      // Log the request asynchronously (fire-and-forget)
      loggingService.logRequest({
        user_id: userId,
        user_query: query,
        enhanced_query: expandedQuery,
        response: response,
        error: null,
        endpoint,
        method,
        response_time_ms: responseTime,
      });

      return response;
    } catch (err: any) {
      error = err?.message || "Unknown error occurred";
      const responseTime = Date.now() - startTime;

      // Log the error asynchronously (fire-and-forget)
      loggingService.logRequest({
        user_id: userId,
        user_query: query,
        enhanced_query: expandedQuery,
        response: null,
        error: error,
        endpoint,
        method,
        response_time_ms: responseTime,
      });

      throw err;
    }
  }

  /**
   * Extract video title from URL
   */
  private extractVideoTitle(videoUrl: string): string {
    try {
      const url = new URL(videoUrl);
      const pathname = url.pathname;
      const filename = pathname.split("/").pop() || "";
      // Remove extension and decode
      const title = decodeURIComponent(filename.split(".")[0] || filename);
      return title || "Video";
    } catch {
      return "Video";
    }
  }

  /**
   * Extract and return video segment file path for download
   */
  async extractVideoSegment(
    videoUrl: string,
    startTime: number,
    endTime: number
  ): Promise<string> {
    return await this.videoProcessingService.extractVideoSegment(
      videoUrl,
      startTime,
      endTime
    );
  }

  /**
   * Remove failed video jobs
   */
  async removeFailedVideoJobs(userId: string, jobIds: string[]) {
    // Verify that all jobs belong to the user
    const jobs = await Promise.all(
      jobIds.map((id) => videoQueueService.getJob(id))
    );

    // Filter out null jobs and verify ownership
    const validJobs = jobs.filter((job) => job !== null && job !== undefined);

    const userJobs = validJobs.filter((job) => job.data?.userId === userId);

    if (userJobs.length === 0 && jobIds.length > 0) {
      throw new Error("No valid jobs found or all jobs do not belong to user");
    }

    // Only remove jobs that belong to the user
    const userJobIds = userJobs
      .map((job) => job.id)
      .filter(Boolean) as string[];

    if (userJobIds.length === 0) {
      return 0;
    }

    return await videoQueueService.removeFailedJobs(userJobIds);
  }

  /**
   * Re-queue failed videos
   */
  async requeueFailedVideos(userId: string, jobIds: string[]) {
    // Verify that all jobs belong to the user
    const jobs = await Promise.all(
      jobIds.map((id) => videoQueueService.getJob(id))
    );

    // Filter out null jobs and verify ownership
    const validJobs = jobs.filter((job) => job !== null && job !== undefined);

    const userJobs = validJobs.filter((job) => job.data?.userId === userId);

    if (userJobs.length === 0 && jobIds.length > 0) {
      throw new Error("No valid jobs found or all jobs do not belong to user");
    }

    // Only re-queue jobs that belong to the user
    const userJobIds = userJobs
      .map((job) => job.id)
      .filter(Boolean) as string[];

    if (userJobIds.length === 0) {
      return [];
    }

    return await videoQueueService.requeueFailedVideos(userJobIds);
  }
}

export default ResourceProcessingController;
