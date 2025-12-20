import { ResourceProcessingService } from "../services/resrouceProcessing.service";
import { UploadsService } from "../services/uploads.service";
import { SupabaseService } from "../services/supabaseService";
import { imageQueueService } from "../services/imageQueue.service";
import { videoQueueService } from "../services/videoQueue.service";
import { loggingService } from "../services/logging.service";
import { VideoProcessingService } from "../services/videoProcessing.service";
import { v4 as uuidv4 } from "uuid";

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
          fileUrl
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
        Expanded:`
      );

      results = await this.resourceProcessingService.searchImages({
        query: expandedQuery,
        userId,
      });

      const responseTime = Date.now() - startTime;

      // Log the request asynchronously (fire-and-forget)
      loggingService.logRequest({
        user_id: userId,
        user_query: query,
        enhanced_query: expandedQuery,
        response: results,
        error: null,
        endpoint,
        method,
        response_time_ms: responseTime,
      });

      return results;
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
    userId: string
  ): Promise<{ jobId: string; totalImages: number; queuedJobs: string[] }> {
    const jobId = uuidv4();
    const jobs = imageUrls.map((imageUrl) => ({
      imageUrl,
      userId,
      jobId,
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
   * Queue a video for processing (async)
   */
  async queueVideo(videoUrl: string, userId: string): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const job = await videoQueueService.addVideoJob({
      videoUrl,
      userId,
      jobId,
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
  ): Promise<Array<{
    id: string;
    score: number;
    text: string;
    videoUrl?: string;
    startTime?: string;
    endTime?: string;
  }>> {
    return await this.videoProcessingService.searchVideos(query, userId, topK);
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
}

export default ResourceProcessingController;
