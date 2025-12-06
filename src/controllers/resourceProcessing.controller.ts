import { ResourceProcessingService } from "../services/resrouceProcessing.service";
import { UploadsService } from "../services/uploads.service";
import { SupabaseService } from "../services/supabaseService";
import { imageQueueService } from "../services/imageQueue.service";
import { v4 as uuidv4 } from "uuid";

class ResourceProcessingController {
  private resourceProcessingService: ResourceProcessingService;
  private uploadsService: UploadsService;
  private supabaseService: SupabaseService;
  constructor() {
    this.resourceProcessingService = new ResourceProcessingService();
    this.uploadsService = new UploadsService();
    this.supabaseService = new SupabaseService();
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

    console.log(
      `Processed ${imagePaths.length} images: ${successful.length} successful, ${failed.length} failed`
    );
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

  async searchImages(query: string, userId: string) {
    const expandedQuery = await this.resourceProcessingService
      .expandQuery(`User Query: "${query}"
        Expanded:`);

    const results = await this.resourceProcessingService.searchImages({
      query: expandedQuery,
      userId,
    });
    return results;
  }

  async queueImages(
    imagePaths: Express.Multer.File[],
    userId: string
  ): Promise<{ jobId: string; totalImages: number; queuedJobs: string[] }> {
    const jobId = uuidv4();
    const jobs = imagePaths.map((image) => ({
      filePath: image.path,
      originalName: image.originalname || image.filename || "unknown",
      userId,
      jobId,
    }));

    const queuedJobs = await imageQueueService.addBulkImageJobs(jobs);

    return {
      jobId,
      totalImages: imagePaths.length,
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
}

export default ResourceProcessingController;
