import { Worker, Job } from "bullmq";
import { redisService } from "../services/redis.service";
import { VideoProcessingService } from "../services/videoProcessing.service";
import { SupabaseService } from "../services/supabaseService";
import { CONFIG } from "../config";
import { VideoJobData } from "../services/videoQueue.service";
import { v4 as uuidv4 } from "uuid";

class VideoProcessingWorker {
  private worker: Worker<VideoJobData>;
  private videoProcessingService: VideoProcessingService;
  private supabaseService: SupabaseService;

  constructor() {
    this.videoProcessingService = new VideoProcessingService();
    this.supabaseService = new SupabaseService();

    this.worker = new Worker<VideoJobData>(
      "video-processing",
      async (job: Job<VideoJobData>) => {
        return await this.processVideo(job);
      },
      {
        connection: redisService.getClient(),
        concurrency: CONFIG.queue.videoProcessing.concurrency,
        limiter: {
          max: 10, // Max 10 jobs per duration (videos are more resource-intensive)
          duration: 1000, // Per second (to rate limit API calls)
        },
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.worker.on("completed", (job) => {
      console.log(`✅ Video processing completed: ${job.id}`);
    });

    this.worker.on("failed", (job, err) => {
      console.error(`❌ Video processing failed: ${job?.id}`, err.message);
    });

    this.worker.on("error", (err) => {
      console.error("Video worker error:", err);
    });

    this.worker.on("active", (job) => {
      console.log(`🔄 Processing video: ${job.id}`);
    });

    this.worker.on("progress", (job, progress) => {
      console.log(`📊 Video processing progress: ${job.id} - ${progress}%`);
    });
  }

  private async processVideo(job: Job<VideoJobData>) {
    const { videoUrl, userId, jobId, collectionName = "Default", ingestionPrompt, collectionProcessing } = job.data;

    try {
      // Update progress: starting
      await job.updateProgress(10);

      // Process and index video in collection namespace
      const result = await this.videoProcessingService.processAndIndexVideo(
        videoUrl,
        userId,
        collectionName,
        ingestionPrompt,
        collectionProcessing
      );

      // Update progress: storing in Supabase
      await job.updateProgress(90);

      // Store video metadata in Supabase
      // Generate a summary description from all chunk summaries
      const summaryDescription = result.results
        .map((r) => r.summary)
        .join(" ")
        .substring(0, 1000); // Limit description length

      // Generate a unique video ID for the video entry
      const videoId = uuidv4();

      await this.supabaseService.postVideos(
        [
          {
            id: videoId,
            description: summaryDescription || "Video processed and indexed",
            videoUrl,
            duration: result.duration,
            resolution: result.resolution,
          },
        ],
        userId,
        collectionName
      );

      // Update progress: completed
      await job.updateProgress(100);

      return {
        success: true,
        jobId,
        videoUrl,
        chunksIndexed: result.chunksIndexed,
        results: result.results,
      };
    } catch (error: any) {
      throw new Error(
        `Failed to process video ${videoUrl}: ${
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
export const videoProcessingWorker = new VideoProcessingWorker();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing video worker...");
  await videoProcessingWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing video worker...");
  await videoProcessingWorker.close();
  process.exit(0);
});



