import { Queue } from "bullmq";
import { redisService } from "./redis.service";
import { v4 as uuidv4 } from "uuid";

import { CollectionProcessingConfig } from "../types/collectionProcessing";

export interface VideoJobData {
  videoUrl: string;
  userId: string;
  jobId: string;
  collectionName?: string;
  /** Custom ingestion prompt from user's selected model; resolved at queue time. */
  ingestionPrompt?: string;
  /** Collection type + settings resolved at queue time. */
  collectionProcessing?: CollectionProcessingConfig;
}

class VideoQueueService {
  private queue: Queue<VideoJobData>;

  constructor() {
    this.queue = new Queue<VideoJobData>("video-processing", {
      connection: redisService.getClient(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    });

    this.queue.on("error", (error) => {
      console.error("Video queue error:", error);
    });
  }

  async addVideoJob(data: VideoJobData) {
    const job = await this.queue.add("process-video", data, {
      jobId: `${data.jobId}-${uuidv4()}`,
    });
    return job;
  }

  async getJob(jobId: string) {
    return await this.queue.getJob(jobId);
  }

  async getJobState(jobId: string) {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress;
    const returnvalue = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      id: job.id,
      state,
      progress,
      data: job.data,
      returnvalue,
      failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  async getJobCounts() {
    return await this.queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed"
    );
  }

  /**
   * Get job counts filtered by userId
   * Returns counts for failed and in-progress (active + waiting) jobs
   */
  async getUserJobCounts(userId: string): Promise<{
    failed: number;
    inProgress: number;
  }> {
    let failed = 0;
    let inProgress = 0;

    try {
      // Get failed jobs (limit to 1000 to avoid performance issues)
      const failedJobs = await this.queue.getJobs(["failed"], 0, 999);
      failed = failedJobs.filter((job) => job.data?.userId === userId).length;

      // Get active jobs (currently being processed)
      const activeJobs = await this.queue.getJobs(["active"], 0, 999);
      const activeCount = activeJobs.filter(
        (job) => job.data?.userId === userId
      ).length;

      // Get waiting jobs (queued but not yet started)
      const waitingJobs = await this.queue.getJobs(["waiting"], 0, 999);
      const waitingCount = waitingJobs.filter(
        (job) => job.data?.userId === userId
      ).length;

      inProgress = activeCount + waitingCount;
    } catch (error) {
      console.error("Error getting user job counts for videos:", error);
      // Return zeros on error to avoid breaking the API
    }

    return {
      failed,
      inProgress,
    };
  }

  /**
   * Get processing and failed videos for a specific user
   * Returns videos with their URLs and job information
   */
  async getUserProcessingAndFailedVideos(userId: string): Promise<{
    processing: Array<{
      id: string;
      videoUrl: string;
      jobId: string;
      state: string;
      progress?: number;
      timestamp?: number;
    }>;
    failed: Array<{
      id: string;
      videoUrl: string;
      jobId: string;
      failedReason?: string;
      timestamp?: number;
    }>;
  }> {
    const processing: Array<{
      id: string;
      videoUrl: string;
      jobId: string;
      state: string;
      progress?: number;
      timestamp?: number;
    }> = [];
    const failed: Array<{
      id: string;
      videoUrl: string;
      jobId: string;
      failedReason?: string;
      timestamp?: number;
    }> = [];

    try {
      // Get active jobs (currently being processed)
      const activeJobs = await this.queue.getJobs(["active"], 0, 999);
      activeJobs
        .filter((job) => job.data?.userId === userId)
        .forEach((job) => {
          processing.push({
            id: job.id || "",
            videoUrl: job.data.videoUrl,
            jobId: job.id || "", // Use BullMQ job ID for tracking
            state: "active",
            progress: typeof job.progress === "number" ? job.progress : undefined,
            timestamp: job.timestamp,
          });
        });

      // Get waiting jobs (queued but not yet started)
      const waitingJobs = await this.queue.getJobs(["waiting"], 0, 999);
      waitingJobs
        .filter((job) => job.data?.userId === userId)
        .forEach((job) => {
          processing.push({
            id: job.id || "",
            videoUrl: job.data.videoUrl,
            jobId: job.id || "", // Use BullMQ job ID for tracking
            state: "waiting",
            timestamp: job.timestamp,
          });
        });

      // Get failed jobs
      const failedJobs = await this.queue.getJobs(["failed"], 0, 999);
      failedJobs
        .filter((job) => job.data?.userId === userId)
        .forEach((job) => {
          failed.push({
            id: job.id || "",
            videoUrl: job.data.videoUrl,
            jobId: job.id || "", // Use BullMQ job ID for removal/requeue operations
            failedReason: job.failedReason || undefined,
            timestamp: job.timestamp,
          });
        });
    } catch (error) {
      console.error("Error getting user processing and failed videos:", error);
    }

    return {
      processing,
      failed,
    };
  }

  /**
   * Remove failed jobs by their IDs
   */
  async removeFailedJobs(jobIds: string[]): Promise<number> {
    let removedCount = 0;
    try {
      for (const jobId of jobIds) {
        const job = await this.queue.getJob(jobId);
        if (job) {
          const state = await job.getState();
          if (state === "failed") {
            await job.remove();
            removedCount++;
          }
        }
      }
    } catch (error) {
      console.error("Error removing failed jobs:", error);
      throw error;
    }
    return removedCount;
  }

  /**
   * Re-queue failed videos by their job IDs
   * This removes the failed job and creates a new job with the same video URL
   */
  async requeueFailedVideos(jobIds: string[]): Promise<Array<{ jobId: string; newJobId: string }>> {
    const results: Array<{ jobId: string; newJobId: string }> = [];
    try {
      for (const jobId of jobIds) {
        const job = await this.queue.getJob(jobId);
        if (job) {
          const state = await job.getState();
          if (state === "failed" && job.data) {
            // Store the video URL, user ID, and options before removing
            const { videoUrl, userId, collectionName, ingestionPrompt, collectionProcessing } = job.data;
            
            // Remove the failed job
            await job.remove();
            
            // Create a new job with a fresh jobId (using uuidv4 in addVideoJob)
            const newJob = await this.addVideoJob({
              videoUrl,
              userId,
              jobId: uuidv4(), // Generate a new jobId for the re-queued job
              collectionName,
              ingestionPrompt,
              collectionProcessing,
            });
            
            results.push({
              jobId,
              newJobId: newJob.id || "",
            });
          }
        }
      }
    } catch (error) {
      console.error("Error re-queueing failed videos:", error);
      throw error;
    }
    return results;
  }

  getQueue() {
    return this.queue;
  }
}

export const videoQueueService = new VideoQueueService();



