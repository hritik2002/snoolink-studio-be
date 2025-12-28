import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { OpenAI } from "openai";
import { v2 as cloudinary } from "cloudinary";
import { CONFIG } from "../config";
import { VectorDBService } from "./vectordb.service";
import { createUserNamespace, createCollectionNamespace } from "../utils/namespace";
import { CostTrackingService } from "./costTracking.service";
import util from "util";
import child_process from "child_process";
import axios from "axios";

const exec = util.promisify(child_process.exec);

const CHUNK_SIZE_SECONDS = 5;

// Configure Cloudinary
cloudinary.config({ ...CONFIG.cloudinary });

export class VideoProcessingService {
  private openaiClient: OpenAI;
  private tempDir: string;
  private costTracker: CostTrackingService;

  constructor() {
    this.openaiClient = new OpenAI({
      apiKey: CONFIG.openai.apiKey,
    });
    this.costTracker = new CostTrackingService();
    this.tempDir = path.join(process.cwd(), "temp");
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Download video from URL to temporary file
   */
  private async downloadVideo(videoUrl: string): Promise<string> {
    console.log("Downloading video from URL:", videoUrl);
    const videoPath = path.join(this.tempDir, `video_${uuidv4()}.mp4`);

    const response = await axios({
      url: videoUrl,
      method: "GET",
      responseType: "stream",
    });

    const writer = fs.createWriteStream(videoPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log("Video downloaded to:", videoPath);
        resolve(videoPath);
      });
      writer.on("error", reject);
    });
  }

  /**
   * Get video duration in seconds
   */
  private async getVideoDuration(videoPath: string): Promise<number> {
    const { stdout } = await exec(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`
    );
    return parseFloat(stdout.trim());
  }

  /**
   * Get video resolution (width x height)
   */
  private async getVideoResolution(videoPath: string): Promise<string | null> {
    try {
      const { stdout } = await exec(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`
      );
      const resolution = stdout.trim();
      return resolution || null;
    } catch (error) {
      console.error(`Error getting video resolution:`, error);
      return null;
    }
  }

  /**
   * Extract 5-second video chunks
   */
  private async extractVideoChunks(
    videoPath: string,
    outputDir: string,
    chunkSize: number = CHUNK_SIZE_SECONDS
  ): Promise<Array<{ filePath: string; start: number; end: number; index: number }>> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const duration = await this.getVideoDuration(videoPath);
    const chunks: Array<{ filePath: string; start: number; end: number; index: number }> = [];
    let start = 0;
    let index = 0;

    console.log(`Video duration: ${duration} seconds`);

    while (start < duration) {
      const end = Math.min(start + chunkSize, duration);
      const outputFile = path.join(outputDir, `chunk_${index}.mp4`);

      await exec(
        `ffmpeg -y -i "${videoPath}" -ss ${start} -t ${chunkSize} -c copy "${outputFile}"`
      );

      chunks.push({ filePath: outputFile, start, end, index });
      start += chunkSize;
      index++;
    }

    return chunks;
  }

  /**
   * Extract 1 frame per second from a video chunk (5 frames for 5 seconds)
   */
  private async extractFramesFromChunk(
    chunkPath: string,
    outputDir: string
  ): Promise<string[]> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const framePattern = path.join(outputDir, `frame_%02d.jpg`);

    // Extract 1 frame per second (fps=1)
    await exec(
      `ffmpeg -y -i "${chunkPath}" -vf "fps=1,scale=640:360" "${framePattern}"`
    );

    // Get all extracted frame files, sorted
    const frameFiles = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".jpg"))
      .map((f) => path.join(outputDir, f))
      .sort();

    return frameFiles;
  }

  /**
   * Upload frame to Cloudinary and get URL
   */
  private async uploadFrameToCloudinary(framePath: string): Promise<{
    url: string;
    publicId: string;
  }> {
    const uploadRes = await cloudinary.uploader.upload(framePath, {
      resource_type: "image",
    });

    return {
      url: uploadRes.secure_url,
      publicId: uploadRes.public_id,
    };
  }

  /**
   * Delete frame from Cloudinary
   */
  private async deleteFrameFromCloudinary(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: "image",
      });
      console.log(`Deleted frame from Cloudinary: ${publicId}`);
    } catch (error) {
      console.error(`Error deleting frame ${publicId}:`, error);
    }
  }

  /**
   * Get GPT vision description of a frame using Cloudinary URL
   */
  private async describeFrameWithGPT(
    frameUrl: string,
    userId: string,
    metadata?: { videoUrl?: string; chunkIndex?: number; collectionName?: string }
  ): Promise<string> {
    const startTime = Date.now();
    let requestId: string | undefined;
    let success = true;
    let errorMessage: string | undefined;

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe what's happening in this video frame in plain text. Be detailed and specific.",
              },
              {
                type: "image_url",
                image_url: { url: frameUrl },
              },
            ],
          },
        ],
      });

      requestId = response.id;
      const responseTime = Date.now() - startTime;

      // Track cost
      await this.costTracker.trackVision(
        {
          userId,
          apiType: "vision",
          model: "gpt-4o-mini",
          operationType: "video_frame_description",
          endpoint: "video_processing",
          context: "Video frame description for semantic indexing",
          metadata: {
            video_url: metadata?.videoUrl,
            chunk_index: metadata?.chunkIndex,
            collection_name: metadata?.collectionName,
            frame_url: frameUrl,
          },
          requestId,
          responseTimeMs: responseTime,
          success: true,
        },
        response.usage,
        1 // 1 image
      );

      return response.choices[0].message.content?.trim() || "";
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : "Unknown error";
      const responseTime = Date.now() - startTime;

      // Track failed call
      await this.costTracker.trackVision(
        {
          userId,
          apiType: "vision",
          model: "gpt-4o-mini",
          operationType: "video_frame_description",
          endpoint: "video_processing",
          context: "Video frame description for semantic indexing",
          metadata: {
            video_url: metadata?.videoUrl,
            chunk_index: metadata?.chunkIndex,
            collection_name: metadata?.collectionName,
            frame_url: frameUrl,
          },
          requestId,
          responseTimeMs: responseTime,
          success: false,
          errorMessage,
        },
        undefined,
        1
      );

      throw error;
    }
  }

  /**
   * Generate summary from frame descriptions
   */
  private async generateClipSummary(
    frameDescriptions: string[],
    userId: string,
    metadata?: { videoUrl?: string; chunkIndex?: number; collectionName?: string }
  ): Promise<string> {
    const frameDescriptionsText = frameDescriptions
      .map((desc, idx) => `Frame ${idx + 1}: ${desc}`)
      .join("\n\n");

    const prompt = `You are analyzing a 5-second video clip. Below are descriptions of 5 frames (one per second).

Frame Descriptions:

${frameDescriptionsText}

Generate a comprehensive summary of what's happening in this 5-second video clip, combining all the visual information from the frames. Be specific and detailed.`;

    const startTime = Date.now();
    let requestId: string | undefined;
    let success = true;
    let errorMessage: string | undefined;

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      requestId = response.id;
      const responseTime = Date.now() - startTime;

      // Track cost
      await this.costTracker.trackChatCompletion(
        {
          userId,
          apiType: "chat_completion",
          model: "gpt-4o-mini",
          operationType: "video_summary",
          endpoint: "video_processing",
          context: "Video clip summary generation from frame descriptions",
          metadata: {
            video_url: metadata?.videoUrl,
            chunk_index: metadata?.chunkIndex,
            collection_name: metadata?.collectionName,
            frame_count: frameDescriptions.length,
            prompt_length: prompt.length,
          },
          requestId,
          responseTimeMs: responseTime,
          success: true,
        },
        response.usage
      );

      return response.choices[0].message.content?.trim() || "";
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : "Unknown error";
      const responseTime = Date.now() - startTime;

      // Track failed call
      await this.costTracker.trackChatCompletion(
        {
          userId,
          apiType: "chat_completion",
          model: "gpt-4o-mini",
          operationType: "video_summary",
          endpoint: "video_processing",
          context: "Video clip summary generation from frame descriptions",
          metadata: {
            video_url: metadata?.videoUrl,
            chunk_index: metadata?.chunkIndex,
            collection_name: metadata?.collectionName,
            frame_count: frameDescriptions.length,
            prompt_length: prompt.length,
          },
          requestId,
          responseTimeMs: responseTime,
          success: false,
          errorMessage,
        },
        undefined
      );

      throw error;
    }
  }

  /**
   * Process a single 5-second chunk
   */
  private async processChunk(
    chunk: { filePath: string; start: number; end: number; index: number },
    videoUrl: string,
    tempDir: string,
    vectorDB: VectorDBService,
    userId: string,
    collectionName?: string
  ): Promise<{ chunkId: string; summary: string; start: number; end: number }> {
    const { filePath: chunkPath, start, end, index } = chunk;

    console.log(`\nProcessing chunk ${index} (${start}s - ${end}s)...`);

    // Step 1: Extract frames (1 per second = 5 frames)
    const framesDir = path.join(tempDir, `frames_${index}`);
    const frameFiles = await this.extractFramesFromChunk(chunkPath, framesDir);

    console.log(`Extracted ${frameFiles.length} frames`);

    // Step 2: Upload frames to Cloudinary, get descriptions, then delete
    const frameDescriptions: string[] = [];

    for (const framePath of frameFiles) {
      // Upload to Cloudinary
      const { url: frameUrl, publicId } = await this.uploadFrameToCloudinary(framePath);
      console.log(`Uploaded frame: ${frameUrl}`);

      // Get GPT description
      const description = await this.describeFrameWithGPT(frameUrl, userId, {
        videoUrl,
        chunkIndex: index,
        collectionName,
      });
      frameDescriptions.push(description);
      console.log(`Frame description: ${description.substring(0, 100)}...`);

      // Delete from Cloudinary
      await this.deleteFrameFromCloudinary(publicId);

      // Delete local frame file
      try {
        fs.unlinkSync(framePath);
      } catch (error) {
        console.error(`Error deleting local frame ${framePath}:`, error);
      }
    }

    // Clean up frames directory
    try {
      fs.rmSync(framesDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Error removing frames directory:`, error);
    }

    // Step 3: Generate summary from frames
    const summary = await this.generateClipSummary(frameDescriptions, userId, {
      videoUrl,
      chunkIndex: index,
      collectionName,
    });
    console.log(`Clip summary: ${summary.substring(0, 150)}...`);

    // Step 4: Embed and store in vector DB
    const chunkId = await vectorDB.upsert(summary, {
      videoUrl,
      startTime: start.toString(),
      endTime: end.toString(),
      resourceType: "video",
      text: summary,
    });

    console.log(`Chunk ${index} indexed successfully`);

    // Clean up chunk file
    try {
      fs.unlinkSync(chunkPath);
    } catch (error) {
      console.error(`Error deleting chunk file:`, error);
    }

    return { chunkId, summary, start, end };
  }

  /**
   * Process video from URL and index all chunks
   */
  async processAndIndexVideo(
    videoUrl: string, 
    userId: string,
    collectionName: string = "Default"
  ): Promise<{
    videoUrl: string;
    chunksIndexed: number;
    results: Array<{ chunkId: string; summary: string; start: number; end: number }>;
    duration?: number;
    resolution?: string;
  }> {
    // Use collection-based namespace for indexing videos
    const namespace = createCollectionNamespace(userId, collectionName, "video");
    const vectorDB = new VectorDBService(namespace, userId);

    // Step 1: Download video from URL
    const videoPath = await this.downloadVideo(videoUrl);

    try {
      // Extract video metadata (duration and resolution)
      const [duration, resolution] = await Promise.all([
        this.getVideoDuration(videoPath).catch((err) => {
          console.error("Error getting video duration:", err);
          return undefined;
        }),
        this.getVideoResolution(videoPath).catch((err) => {
          console.error("Error getting video resolution:", err);
          return undefined;
        }),
      ]);

      console.log(`Video metadata - Duration: ${duration}s, Resolution: ${resolution}`);

      // Step 2: Extract 5-second chunks
      const chunksDir = path.join(this.tempDir, uuidv4());
      const chunks = await this.extractVideoChunks(
        videoPath,
        chunksDir,
        CHUNK_SIZE_SECONDS
      );

      console.log(`\nExtracted ${chunks.length} chunks`);

      // Step 3: Process each chunk
      const results: Array<{ chunkId: string; summary: string; start: number; end: number }> = [];

      for (const chunk of chunks) {
        try {
          const result = await this.processChunk(chunk, videoUrl, chunksDir, vectorDB, userId, collectionName);
          results.push(result);
        } catch (error) {
          console.error(`Error processing chunk ${chunk.index}:`, error);
        }
      }

      // Clean up chunks directory
      try {
        fs.rmSync(chunksDir, { recursive: true, force: true });
      } catch (error) {
        console.error("Error cleaning up chunks directory:", error);
      }

      console.log("\n✅ Video indexing complete!");

      return {
        videoUrl,
        chunksIndexed: results.length,
        results,
        duration,
        resolution: resolution || undefined,
      };
    } finally {
      // Clean up downloaded video
      try {
        fs.unlinkSync(videoPath);
      } catch (error) {
        console.error("Error deleting downloaded video:", error);
      }
    }
  }

  /**
   * Search for video clips by text query
   */
  async searchVideos(query: string, userId: string, topK: number = 5): Promise<Array<{
    id: string;
    score: number;
    text: string;
    videoUrl?: string;
    startTime?: string;
    endTime?: string;
  }>> {
    const namespace = createUserNamespace(userId, "video");
    const vectorDB = new VectorDBService(namespace);

    const results = await vectorDB.query(query, topK);

    return results.matches.map((m) => ({
      id: m.id || "",
      score: m.score || 0,
      text: (m.metadata?.text as string) || "",
      videoUrl: m.metadata?.videoUrl as string | undefined,
      startTime: m.metadata?.startTime as string | undefined,
      endTime: m.metadata?.endTime as string | undefined,
    }));
  }

  /**
   * Search videos across multiple collections using Promise.all
   * Results are merged and sorted by score
   */
  async searchVideosMultipleCollections(
    query: string,
    userId: string,
    collections: string[],
    topK: number = 5
  ): Promise<Array<{
    id: string;
    score: number;
    text: string;
    videoUrl?: string;
    startTime?: string;
    endTime?: string;
    collectionName?: string;
  }>> {
    if (collections.length === 0) {
      return [];
    }

    // Create search promises for each collection
    const searchPromises = collections.map(async (collectionName) => {
      try {
        // Use collection-based namespace for videos
        const namespace = createCollectionNamespace(userId, collectionName, "video");
        const vectorDB = new VectorDBService(namespace);
        const results = await vectorDB.query(query, topK);

        // If searching "Default" and no results, also try legacy namespace for backward compatibility
        if (collectionName === "Default" && results.matches.length === 0) {
          console.log(`No results in new namespace for Default videos, trying legacy namespace...`);
          try {
            const legacyNamespace = createUserNamespace(userId, "video"); // Legacy: user-{userId}-videos
            const legacyVectorDB = new VectorDBService(legacyNamespace);
            const legacyResults = await legacyVectorDB.query(query, topK);
            return legacyResults.matches.map((m) => ({
              id: m.id || "",
              score: m.score || 0,
              text: (m.metadata?.text as string) || "",
              videoUrl: m.metadata?.videoUrl as string | undefined,
              startTime: m.metadata?.startTime as string | undefined,
              endTime: m.metadata?.endTime as string | undefined,
              collectionName,
            }));
          } catch (legacyError) {
            console.error(`Error searching legacy video namespace:`, legacyError);
          }
        }

        return results.matches.map((m) => ({
          id: m.id || "",
          score: m.score || 0,
          text: (m.metadata?.text as string) || "",
          videoUrl: m.metadata?.videoUrl as string | undefined,
          startTime: m.metadata?.startTime as string | undefined,
          endTime: m.metadata?.endTime as string | undefined,
          collectionName,
        }));
      } catch (error) {
        console.error(`Error searching videos in collection ${collectionName}:`, error);
        return [];
      }
    });

    // Execute all searches in parallel
    const allResults = await Promise.all(searchPromises);

    // Flatten and merge results
    const mergedResults = allResults.flat();

    // Sort by score descending
    mergedResults.sort((a, b) => b.score - a.score);

    // Return top K results across all collections
    return mergedResults.slice(0, topK);
  }

  /**
   * Extract a video segment from startTime to endTime and return the file path
   */
  async extractVideoSegment(
    videoUrl: string,
    startTime: number,
    endTime: number
  ): Promise<string> {
    // Download the video
    const videoPath = await this.downloadVideo(videoUrl);

    try {
      // Calculate duration
      const duration = endTime - startTime;

      // Create output file path
      const outputFile = path.join(this.tempDir, `segment_${uuidv4()}.mp4`);

      // Extract segment using ffmpeg
      await exec(
        `ffmpeg -y -i "${videoPath}" -ss ${startTime} -t ${duration} -c copy "${outputFile}"`
      );

      // Verify the output file exists
      if (!fs.existsSync(outputFile)) {
        throw new Error("Failed to create video segment");
      }

      return outputFile;
    } finally {
      // Clean up downloaded video
      try {
        fs.unlinkSync(videoPath);
      } catch (error) {
        console.error("Error deleting downloaded video:", error);
      }
    }
  }
}


