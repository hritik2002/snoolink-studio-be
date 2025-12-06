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
      console.error(
        `❌ Image processing failed: ${job?.id}`,
        err.message
      );
    });

    this.worker.on("error", (err) => {
      console.error("Worker error:", err);
    });

    this.worker.on("active", (job) => {
      console.log(`🔄 Processing image: ${job.id}`);
    });
  }

  private async processImage(job: Job<ImageJobData>) {
    const { filePath, originalName, userId, jobId } = job.data;

    try {
      // Update job progress
      await job.updateProgress(10);

      // Upload file to Cloudinary
      const { fileUrl } = await this.uploadsService.handleFileUpload(
        filePath,
        "image"
      );
      await job.updateProgress(30);

      // Clean up local file after upload
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Get image description from LLM
      const description = await this.resourceProcessingService.describeImage(
        fileUrl
      );
      await job.updateProgress(60);

      // Embed image in vector database
      const id = await this.resourceProcessingService.embedImage({
        description,
        imageUrl: fileUrl,
        userId,
      });
      await job.updateProgress(90);

      // Store in Supabase (optional - uncomment if needed)
      await this.supabaseService.postImages([{ id, description, imageUrl: fileUrl }], userId);

      await job.updateProgress(100);

      return {
        success: true,
        id,
        description,
        imageUrl: fileUrl,
        originalName,
      };
    } catch (error: any) {
      // Update job progress to indicate failure
      await job.updateProgress(0);

      throw new Error(
        `Failed to process image ${originalName}: ${error?.message || "Unknown error"}`
      );
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
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

