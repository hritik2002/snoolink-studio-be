import { Queue } from "bullmq";
import { redisService } from "./redis.service";
import { v4 as uuidv4 } from "uuid";

export interface VideoJobData {
  videoUrl: string;
  userId: string;
  jobId: string;
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

  getQueue() {
    return this.queue;
  }
}

export const videoQueueService = new VideoQueueService();

