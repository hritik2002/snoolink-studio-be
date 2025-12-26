import { Worker, Job } from "bullmq";
import fs from "fs";
import { redisService } from "../services/redis.service";
import { ResourceProcessingService } from "../services/resrouceProcessing.service";
import { UploadsService } from "../services/uploads.service";
import { SupabaseService } from "../services/supabaseService";
import { CONFIG } from "../config";
import { ImageJobData } from "../services/imageQueue.service";

class ImageProcessingWorker {
  private worker: Worker<ImageJobData>;
  private resourceProcessingService: ResourceProcessingService;
  private uploadsService: UploadsService;
  private supabaseService: SupabaseService;

  constructor() {
    this.resourceProcessingService = new ResourceProcessingService();
    this.uploadsService = new UploadsService();
    this.supabaseService = new SupabaseService();

    this.worker = new Worker<ImageJobData>(
      "image-processing",
      async (job: Job<ImageJobData>) => {
        return await this.processImage(job);
      },
      {
        connection: redisService.getClient(),
        concurrency: CONFIG.queue.imageProcessing.concurrency,
        limiter: {
          max: 50, // Max 50 jobs
          duration: 1000, // Per second (to rate limit OpenAI API calls)
        },
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.worker.on("completed", (job) => {
      console.log(`✅ Image processing completed: ${job.id}`);
    });

    this.worker.on("failed", (job, err) => {
      console.error(`❌ Image processing failed: ${job?.id}`, err.message);
    });

    this.worker.on("error", (err) => {
      console.error("Worker error:", err);
    });

    this.worker.on("active", (job) => {
      console.log(`🔄 Processing image: ${job.id}`);
    });
  }

  private async processImage(job: Job<ImageJobData>) {
    const { imageUrl, userId, jobId, collectionName = "Default" } = job.data;

    try {
      const description = await this.resourceProcessingService.describeImage(
        imageUrl,
        userId,
        {
          collectionName,
          resourceType: "image",
          endpoint: "image_processing_worker",
        }
      );

      // Embed image in vector database with collection namespace
      const id = await this.resourceProcessingService.embedImage({
        description,
        imageUrl,
        userId,
        collectionName,
      });

      await this.supabaseService.postImages(
        [{ id, description, imageUrl }],
        userId,
        collectionName
      );

      return {
        success: true,
        id,
        description,
        imageUrl,
      };
    } catch (error: any) {
      throw new Error(
        `Failed to process image ${imageUrl}: ${
          error?.message || "Unknown error"
        }`
      );
    }
  }

  async close() {
    await this.worker.close();
  }
}

// Create and export worker instance
export const imageProcessingWorker = new ImageProcessingWorker();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing worker...");
  await imageProcessingWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing worker...");
  await imageProcessingWorker.close();
  process.exit(0);
});
