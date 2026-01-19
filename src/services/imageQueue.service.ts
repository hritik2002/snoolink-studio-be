import { Queue } from "bullmq";
import { redisService } from "./redis.service";
import { v4 as uuidv4 } from "uuid";

export interface ImageJobData {
  imageUrl: string;
  userId: string;
  jobId: string;
  collectionName?: string;
  /** Custom ingestion prompt from user's selected model; resolved at queue time. */
  ingestionPrompt?: string;
}

class ImageQueueService {
  private queue: Queue<ImageJobData>;

  constructor() {
    this.queue = new Queue<ImageJobData>("image-processing", {
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
      console.error("Image queue error:", error);
    });
  }

  async addImageJob(data: ImageJobData) {
    const job = await this.queue.add("process-image", data, {
      jobId: `${data.jobId}-${uuidv4()}`,
    });
    return job;
  }

  async addBulkImageJobs(jobs: ImageJobData[]) {
    const bullJobs = jobs.map((data) => ({
      name: "process-image",
      data,
      opts: {
        jobId: `${data.jobId}-${uuidv4()}`,
      },  
    }));

    return await this.queue.addBulk(bullJobs);
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
      console.error("Error getting user job counts for images:", error);
      // Return zeros on error to avoid breaking the API
    }

    return {
      failed,
      inProgress,
    };
  }

  /**
   * Get processing and failed images for a specific user
   * Returns images with their URLs and job information
   */
  async getUserProcessingAndFailedImages(userId: string): Promise<{
    processing: Array<{
      id: string;
      imageUrl: string;
      jobId: string;
      state: string;
      progress?: number;
      timestamp?: number;
    }>;
    failed: Array<{
      id: string;
      imageUrl: string;
      jobId: string;
      failedReason?: string;
      timestamp?: number;
    }>;
  }> {
    const processing: Array<{
      id: string;
      imageUrl: string;
      jobId: string;
      state: string;
      progress?: number;
      timestamp?: number;
    }> = [];
    const failed: Array<{
      id: string;
      imageUrl: string;
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
            imageUrl: job.data.imageUrl,
            jobId: job.data.jobId,
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
            imageUrl: job.data.imageUrl,
            jobId: job.data.jobId,
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
            imageUrl: job.data.imageUrl,
            jobId: job.data.jobId,
            failedReason: job.failedReason || undefined,
            timestamp: job.timestamp,
          });
        });
    } catch (error) {
      console.error("Error getting user processing and failed images:", error);
    }

    return {
      processing,
      failed,
    };
  }

  getQueue() {
    return this.queue;
  }
}

export const imageQueueService = new ImageQueueService();

