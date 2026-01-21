import { ResourceProcessingService } from "../services/resrouceProcessing.service";
import { UploadsService } from "../services/uploads.service";
import { SupabaseService } from "../services/supabaseService";
import { promptsService } from "../services/prompts.service";
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
  // Request deduplication: track pending requests to avoid duplicate work
  private pendingRequests = new Map<string, Promise<any>>();

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
        const { id, description: embedDescription } = await this.resourceProcessingService.embedImage({
          description,
          imageUrl: fileUrl,
          userId,
          collectionName: "Default",
        });

        return {
          success: true,
          data: {
            id,
            description: embedDescription,
            imageUrl: fileUrl,
          },
          error: null,
        };
      } catch (error: any) {
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
   * @param expandQuery - when false, appends :noexpand so expanded vs raw queries don't share cache
   * @param minScore - included so cache varies when user changes min score
   */
  private getSearchCacheKey(
    userId: string,
    query: string,
    collections: string[],
    topK: number,
    type: "image" | "video",
    expandQuery: boolean = true,
    minScore: number = 0.5
  ): string {
    // Sort collections to ensure consistent cache key
    const sortedCollections = [...collections].sort().join(",");
    // Create hash of query to keep key length manageable
    const queryHash = crypto
      .createHash("md5")
      .update(query.toLowerCase().trim())
      .digest("hex")
      .substring(0, 16);
    const expandSuffix = expandQuery ? "" : ":noexpand";
    return `search:${type}:${userId}:${queryHash}:${sortedCollections}:${topK}${expandSuffix}:m${minScore.toFixed(2)}`;
  }

  /** User's search settings: prompt for expansion and minScore for vector filtering. */
  private async getSearchSettings(userId: string): Promise<{ searchPrompt?: string; minScore: number }> {
    try {
      const s = await this.supabaseService.getUserModelSettings(userId);
      const searchPrompt = s.search_model ? (await promptsService.getByModel(s.search_model))?.prompt ?? undefined : undefined;
      const minScore = s.min_score != null && !Number.isNaN(s.min_score) ? Math.max(0, Math.min(1, s.min_score)) : 0.5;
      return { searchPrompt, minScore };
    } catch {
      return { searchPrompt: undefined, minScore: 0.5 };
    }
  }

  async searchImages(
    query: string,
    userId: string,
    endpoint: string = "/api/media/search-images",
    method: string = "GET",
    collectionName: string = "Default",
    expandQuery: boolean = true
  ) {
    const startTime = Date.now();
    let expandedQuery: string | null = null;
    let results: any = null;
    let error: string | null = null;

    const searchSettings = await this.getSearchSettings(userId);
    // Check cache FIRST with original query (before expansion)
    const cacheKey = this.getSearchCacheKey(
      userId,
      query,
      [collectionName],
      5,
      "image",
      expandQuery,
      searchSettings.minScore
    );

    // Check for pending request (deduplication)
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    // Check cache
    const cached = await redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    // Create search promise
    const searchPromise = (async () => {
      try {
        // Expand queries to match detailed database descriptions (skip when expandQuery is false)
        let expandedQueryResult: string;
        if (expandQuery) {
          try {
            expandedQueryResult = await this.resourceProcessingService.expandQuery(
              `Expand the following search query:\n\n${query}`,
              userId,
              endpoint,
              searchSettings.searchPrompt
            );
          } catch {
            expandedQueryResult = query; // Fallback to original on error
          }
        } else {
          expandedQueryResult = query;
        }
        expandedQuery = expandedQueryResult;

        results = await this.resourceProcessingService.searchImages({
          query: expandedQuery,
          userId,
          collectionName,
          minScore: searchSettings.minScore,
        });

        const response = {
          results,
          expandedQuery,
          collectionsSearched: [collectionName], // Use provided collection name
        };

        // Cache the results (15 minutes TTL for search results)
        await redisService.set(cacheKey, response, 900);

        const responseTime = Date.now() - startTime;

        // Log asynchronously (don't await)
        setImmediate(() => {
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
        });

        return response;
      } catch (err: any) {
        error = err?.message || "Unknown error occurred";
        const responseTime = Date.now() - startTime;

        // Log error asynchronously
        setImmediate(() => {
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
        });

        throw err;
      } finally {
        // Remove from pending requests
        this.pendingRequests.delete(cacheKey);
      }
    })();

    // Store pending request
    this.pendingRequests.set(cacheKey, searchPromise);
    return searchPromise;
  }

  /**
   * Search across multiple collections
   * @param query - Search query
   * @param userId - User ID
   * @param collections - Array of collection names to search in
   * @param topK - Number of results per collection (default 5)
   * @param expandQuery - If false, skip LLM expansion and search with the raw query (default true)
   */
  async searchMultipleCollections(
    query: string,
    userId: string,
    collections: string[],
    topK: number = 5,
    endpoint: string = "/api/media/search",
    method: string = "GET",
    expandQuery: boolean = true
  ) {
    // Early return for empty collections
    if (collections.length === 0) {
      return {
        results: [],
        expandedQuery: null,
        collectionsSearched: [],
      };
    }

    const startTime = Date.now();
    let expandedQuery: string | null = null;
    let results: any = null;
    let error: string | null = null;

    const searchSettings = await this.getSearchSettings(userId);
    // Check cache FIRST with original query (before expansion)
    const cacheKey = this.getSearchCacheKey(
      userId,
      query,
      collections,
      topK,
      "image",
      expandQuery,
      searchSettings.minScore
    );

    // Check for pending request (deduplication)
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    // Check cache
    const cached = await redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    // Create search promise
    const searchPromise = (async () => {
      try {
        // Expand queries to match detailed database descriptions (skip when expandQuery is false)
        let expandedQueryResult: string;
        if (expandQuery) {
          try {
            expandedQueryResult = await this.resourceProcessingService.expandQuery(
              `Expand the following search query:\n\n${query}`,
              userId,
              endpoint,
              searchSettings.searchPrompt
            );
          } catch {
            expandedQueryResult = query; // Fallback to original on error
          }
        } else {
          expandedQueryResult = query;
        }
        expandedQuery = expandedQueryResult;

        results =
          await this.resourceProcessingService.searchMultipleCollections({
            query: expandedQuery,
            userId,
            collections,
            topK,
            minScore: searchSettings.minScore,
          });

        const response = {
          results,
          expandedQuery,
          collectionsSearched: collections,
        };

        // Cache the results (15 minutes TTL for search results)
        await redisService.set(cacheKey, response, 900);

        const responseTime = Date.now() - startTime;

        // Log asynchronously (don't await)
        setImmediate(() => {
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
        });

        return response;
      } catch (err: any) {
        error = err?.message || "Unknown error occurred";
        const responseTime = Date.now() - startTime;

        // Log error asynchronously
        setImmediate(() => {
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
        });

        throw err;
      } finally {
        // Remove from pending requests
        this.pendingRequests.delete(cacheKey);
      }
    })();

    // Store pending request
    this.pendingRequests.set(cacheKey, searchPromise);
    return searchPromise;
  }

  async queueImages(
    imageUrls: string[],
    userId: string,
    collectionName: string = "Default"
  ): Promise<{ jobId: string; totalImages: number; queuedJobs: string[] }> {
    let ingestionPrompt: string | undefined;
    try {
      const s = await this.supabaseService.getUserModelSettings(userId);
      if (s.ingestion_model) {
        const row = await promptsService.getByModel(s.ingestion_model);
        ingestionPrompt = row?.prompt;
      }
    } catch {
      // ignore; use default
    }

    const jobId = uuidv4();
    const jobs = imageUrls.map((imageUrl) => ({
      imageUrl,
      userId,
      jobId,
      collectionName,
      ingestionPrompt,
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
    let ingestionPrompt: string | undefined;
    try {
      const s = await this.supabaseService.getUserModelSettings(userId);
      if (s.ingestion_model) {
        const row = await promptsService.getByModel(s.ingestion_model);
        ingestionPrompt = row?.prompt;
      }
    } catch {
      // ignore; use default
    }

    const jobId = uuidv4();
    const job = await videoQueueService.addVideoJob({
      videoUrl,
      userId,
      jobId,
      collectionName,
      ingestionPrompt,
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
      throw new Error(`Failed to process video: ${error.message}`);
    }
  }

  /**
   * Search videos across multiple collections
   * @param expandQuery - If false, skip LLM expansion and search with the raw query (default true)
   */
  async searchVideosMultipleCollections(
    query: string,
    userId: string,
    collections: string[],
    topK: number = 10,
    endpoint: string = "/api/media/search-videos-collections",
    method: string = "GET",
    expandQuery: boolean = true
  ) {
    // Early return for empty collections
    if (collections.length === 0) {
      return {
        results: {},
        expandedQuery: null,
        collectionsSearched: [],
      };
    }

    const startTime = Date.now();
    let expandedQuery: string | null = null;
    let results: any = null;
    let error: string | null = null;

    const searchSettings = await this.getSearchSettings(userId);
    // Check cache FIRST with original query (before expansion)
    const cacheKey = this.getSearchCacheKey(
      userId,
      query,
      collections,
      topK,
      "video",
      expandQuery,
      searchSettings.minScore
    );

    // Check for pending request (deduplication)
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    // Check cache
    const cached = await redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    // Create search promise
    const searchPromise = (async () => {
      try {
        // Expand queries to match detailed database descriptions (skip when expandQuery is false)
        let expandedQueryResult: string;
        if (expandQuery) {
          try {
            expandedQueryResult = await this.resourceProcessingService.expandQuery(
              `Expand the following search query:\n\n${query}`,
              userId,
              endpoint,
              searchSettings.searchPrompt
            );
          } catch {
            expandedQueryResult = query; // Fallback to original on error
          }
        } else {
          expandedQueryResult = query;
        }
        expandedQuery = expandedQueryResult;

        const groupedResults =
          await this.videoProcessingService.searchVideosMultipleCollections(
            expandedQuery,
            userId,
            collections,
            topK,
            searchSettings.minScore
          );

        const enrichedResults: Record<string, any> = {};

        for (const [videoUrl, videoResult] of Object.entries(groupedResults)) {
          try {
            const videoMetadata =
              await this.supabaseService.getVideoMetadataByUrl(
                userId,
                videoUrl
              );
            enrichedResults[videoUrl] = {
              ...videoResult,
              videoId: videoMetadata?.id,
              title: this.extractVideoTitle(videoUrl),
              duration: videoMetadata?.duration,
              resolution: videoMetadata?.resolution,
            };
          } catch {
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

        // Log asynchronously (don't await)
        setImmediate(() => {
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
        });

        return response;
      } catch (err: any) {
        error = err?.message || "Unknown error occurred";
        const responseTime = Date.now() - startTime;

        // Log error asynchronously
        setImmediate(() => {
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
        });

        throw err;
      } finally {
        // Remove from pending requests
        this.pendingRequests.delete(cacheKey);
      }
    })();

    // Store pending request
    this.pendingRequests.set(cacheKey, searchPromise);
    return searchPromise;
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
