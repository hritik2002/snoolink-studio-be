import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { OpenAI } from "openai";
import { v2 as cloudinary } from "cloudinary";
import { CONFIG } from "../config";
import { VectorDBService } from "./vectordb.service";
import { createCollectionNamespace } from "../utils/namespace";
import { CostTrackingService } from "./costTracking.service";
import util from "util";
import child_process from "child_process";
import axios from "axios";

const exec = util.promisify(child_process.exec);

const CHUNK_SIZE_SECONDS = 5; // Legacy - kept for fallback
const SCENE_DETECTION_THRESHOLD = 0.2; // FFmpeg scene detection sensitivity (0.0-1.0, lower = more sensitive) - lowered for better detection
const KEYFRAMES_PER_SCENE = 1; // Extract 1-2 keyframes per scene
const FRAME_SAMPLE_RATE = 1.5; // Sample at 1-2 fps for additional context
const MAX_SCENE_DURATION = 10; // If scene is longer than this, sample at regular intervals (seconds)
const KEYFRAME_INTERVAL = 5; // Extract keyframe every N seconds for long scenes

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
    const videoPath = path.join(this.tempDir, `video_${uuidv4()}.mp4`);

    const response = await axios({
      url: videoUrl,
      method: "GET",
      responseType: "stream",
    });

    const writer = fs.createWriteStream(videoPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(videoPath));
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
   * Detect scene changes using FFmpeg scene detection filter
   * Uses multiple methods for better reliability
   * Returns array of scene boundaries in seconds
   */
  private async detectScenes(videoPath: string): Promise<Array<{ start: number; end: number; index: number }>> {
    try {
      // Get video duration first
      const duration = await this.getVideoDuration(videoPath);
      console.log(`Analyzing video for scene changes (duration: ${duration.toFixed(1)}s, threshold: ${SCENE_DETECTION_THRESHOLD})...`);

      // Method 1: Use FFmpeg scene detection with select filter
      // This is more reliable and outputs frame timestamps
      const sceneChangeTimes: number[] = [0]; // Always start at 0
      
      try {
        // Use scene filter with showinfo to get timestamps
        // The scene filter outputs when scene change is detected
        const { stderr } = await exec(
          `ffmpeg -i "${videoPath}" -vf "select='gt(scene,${SCENE_DETECTION_THRESHOLD})',showinfo" -vsync 0 -f null - 2>&1 || true`
        );

        // Parse scene change timestamps from FFmpeg output
        // Look for pts_time in showinfo output
        const ptsTimeRegex = /pts_time:([\d.]+)/g;
        let match;
        
        while ((match = ptsTimeRegex.exec(stderr)) !== null) {
          const time = parseFloat(match[1]);
          if (!isNaN(time) && time > 0 && time < duration) {
            sceneChangeTimes.push(time);
          }
        }

        // Also try alternative parsing - sometimes it's in different format
        const alternativeRegex = /(?:n:\d+\s+pts:\d+\s+pts_time:([\d.]+)|time:([\d.]+))/g;
        let altMatch;
        while ((altMatch = alternativeRegex.exec(stderr)) !== null) {
          const time = parseFloat(altMatch[1] || altMatch[2]);
          if (!isNaN(time) && time > 0 && time < duration) {
            sceneChangeTimes.push(time);
          }
        }

        console.log(`Found ${sceneChangeTimes.length - 1} potential scene changes from FFmpeg output`);
      } catch (error) {
        console.warn("Error parsing FFmpeg scene detection output:", error);
      }

      // Method 2: If no scenes found, try using scene filter with different approach
      if (sceneChangeTimes.length <= 1) {
        console.log("Trying alternative scene detection method...");
        try {
          // Use scene filter with metadata output
          const { stderr: stderr2 } = await exec(
            `ffmpeg -i "${videoPath}" -vf "select='gt(scene,${SCENE_DETECTION_THRESHOLD})',metadata=print:file=-" -f null - 2>&1 || true`
          );
          
          // Parse metadata output
          const metadataRegex = /lavfi\.select\.scene=([\d.]+)/g;
          let metaMatch;
          while ((metaMatch = metadataRegex.exec(stderr2)) !== null) {
            const time = parseFloat(metaMatch[1]);
            if (!isNaN(time) && time > 0 && time < duration) {
              sceneChangeTimes.push(time);
            }
          }
        } catch (error) {
          console.warn("Alternative scene detection method failed:", error);
        }
      }

      // Method 3: If still no scenes, use lower threshold as fallback
      if (sceneChangeTimes.length <= 1 && SCENE_DETECTION_THRESHOLD > 0.15) {
        console.log("No scenes detected, trying with lower threshold (0.15)...");
        try {
          const { stderr: stderr3 } = await exec(
            `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.15)',showinfo" -vsync 0 -f null - 2>&1 || true`
          );
          
          const ptsTimeRegex = /pts_time:([\d.]+)/g;
          let match;
          while ((match = ptsTimeRegex.exec(stderr3)) !== null) {
            const time = parseFloat(match[1]);
            if (!isNaN(time) && time > 0 && time < duration) {
              sceneChangeTimes.push(time);
            }
          }
        } catch (error) {
          console.warn("Lower threshold detection failed:", error);
        }
      }

      // Add end time
      sceneChangeTimes.push(duration);
      
      // Remove duplicates and sort
      const uniqueChanges = [...new Set(sceneChangeTimes)].sort((a, b) => a - b);
      
      console.log(`Scene change timestamps: ${uniqueChanges.map(t => t.toFixed(1)).join(', ')}`);

      // Create scene segments
      const scenes: Array<{ start: number; end: number; index: number }> = [];
      let index = 0;
      const minSceneDuration = 0.5; // Lowered minimum scene duration to 0.5s

      for (let i = 0; i < uniqueChanges.length - 1; i++) {
        const sceneStart = uniqueChanges[i];
        const sceneEnd = uniqueChanges[i + 1];
        const sceneDuration = sceneEnd - sceneStart;

        // Process scenes longer than minimum duration
        if (sceneDuration >= minSceneDuration) {
          scenes.push({
            start: sceneStart,
            end: sceneEnd,
            index: index++,
          });
        } else {
          // Merge very short scenes with previous scene
          if (scenes.length > 0) {
            scenes[scenes.length - 1].end = sceneEnd;
          }
        }
      }

      // If still no scenes detected, force scene breaks at regular intervals
      // This ensures we don't have one massive scene
      if (scenes.length === 0 || (scenes.length === 1 && scenes[0].end - scenes[0].start > 15)) {
        console.log(`⚠️  No scene changes detected or single scene too long (${scenes[0]?.end - scenes[0]?.start || duration}s)`);
        console.log("Forcing scene breaks at 10-second intervals for better coverage...");
        
        // Force scene breaks every 10 seconds
        const forcedScenes: Array<{ start: number; end: number; index: number }> = [];
        let forcedStart = 0;
        let forcedIndex = 0;
        const forcedInterval = 10; // Force breaks every 10 seconds
        
        while (forcedStart < duration) {
          const forcedEnd = Math.min(forcedStart + forcedInterval, duration);
          forcedScenes.push({
            start: forcedStart,
            end: forcedEnd,
            index: forcedIndex++,
          });
          forcedStart = forcedEnd;
        }
        
        console.log(`✅ Created ${forcedScenes.length} forced scenes (${forcedInterval}s intervals)`);
        return forcedScenes;
      }

      // Calculate reduction percentage
      const fixedChunksCount = Math.ceil(duration / CHUNK_SIZE_SECONDS);
      const reduction = fixedChunksCount > 0 
        ? Math.round((1 - scenes.length / fixedChunksCount) * 100)
        : 0;
      
      const avgSceneDuration = scenes.length > 0 
        ? (scenes.reduce((sum, s) => sum + (s.end - s.start), 0) / scenes.length).toFixed(1)
        : duration.toFixed(1);

      console.log(`✅ Detected ${scenes.length} scenes (avg ${avgSceneDuration}s each, ${reduction}% reduction from ${fixedChunksCount} fixed chunks)`);
      return scenes;
    } catch (error) {
      console.error("❌ Scene detection failed, falling back to fixed chunks:", error);
      // Fallback to fixed chunks if scene detection fails
      return this.extractVideoChunksLegacy(videoPath);
    }
  }

  /**
   * Legacy: Extract fixed 5-second video chunks (fallback)
   */
  private async extractVideoChunksLegacy(
    videoPath: string
  ): Promise<Array<{ start: number; end: number; index: number }>> {
    const duration = await this.getVideoDuration(videoPath);
    const chunks: Array<{ start: number; end: number; index: number }> = [];
    let start = 0;
    let index = 0;

    while (start < duration) {
      const end = Math.min(start + CHUNK_SIZE_SECONDS, duration);
      chunks.push({ start, end, index });
      start += CHUNK_SIZE_SECONDS;
      index++;
    }

    return chunks;
  }

  /**
   * Extract keyframes from a scene
   * For short scenes: extracts 1-2 keyframes (middle or 1/3, 2/3)
   * For long scenes (>MAX_SCENE_DURATION): samples at regular intervals
   * Keyframes are chosen to be most representative of the scene content
   */
  private async extractKeyframesFromScene(
    videoPath: string,
    scene: { start: number; end: number; index: number },
    outputDir: string
  ): Promise<string[]> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const sceneDuration = scene.end - scene.start;
    const keyframes: string[] = [];

    // For long scenes, sample at regular intervals instead of just 1-2 keyframes
    if (sceneDuration > MAX_SCENE_DURATION) {
      // Sample keyframes every KEYFRAME_INTERVAL seconds
      const numKeyframes = Math.ceil(sceneDuration / KEYFRAME_INTERVAL);
      const keyframeTimes: number[] = [];
      
      // Start from middle of first interval, then sample every KEYFRAME_INTERVAL seconds
      for (let i = 0; i < numKeyframes; i++) {
        const time = scene.start + (i * KEYFRAME_INTERVAL) + (KEYFRAME_INTERVAL / 2);
        // Ensure we don't go beyond scene end
        if (time < scene.end) {
          keyframeTimes.push(time);
        }
      }
      
      // Always include a keyframe near the end if we haven't already
      if (keyframeTimes.length === 0 || keyframeTimes[keyframeTimes.length - 1] < scene.end - 1) {
        keyframeTimes.push(scene.end - 0.5); // 0.5s before end
      }

      console.log(`Scene ${scene.index} is ${sceneDuration.toFixed(1)}s long - extracting ${keyframeTimes.length} keyframes at intervals`);

      // Extract all keyframes in parallel
      const extractionPromises = keyframeTimes.map(async (time, idx) => {
        const framePath = path.join(outputDir, `keyframe_${scene.index}_${idx}.jpg`);
        try {
      await exec(
            `ffmpeg -y -ss ${time.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${framePath}"`
          );
          if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) {
            return framePath;
          }
        } catch (error) {
          console.error(`Error extracting keyframe ${idx} for scene ${scene.index} at ${time.toFixed(1)}s:`, error);
        }
        return null;
      });

      const extractedFrames = await Promise.all(extractionPromises);
      keyframes.push(...extractedFrames.filter((f): f is string => f !== null));
    } else {
      // For short scenes, use the original 1-2 keyframe strategy
      if (KEYFRAMES_PER_SCENE === 1) {
        // Extract middle frame of the scene (most representative)
        const middleTime = scene.start + sceneDuration / 2;
        const framePath = path.join(outputDir, `keyframe_${scene.index}_0.jpg`);
        
        try {
          await exec(
            `ffmpeg -y -ss ${middleTime.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${framePath}"`
          );
          
          if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) {
            keyframes.push(framePath);
          } else {
            console.warn(`Failed to extract keyframe for scene ${scene.index} at ${middleTime.toFixed(1)}s`);
          }
        } catch (error) {
          console.error(`Error extracting keyframe for scene ${scene.index}:`, error);
        }
      } else {
        // Extract 2 keyframes: one at 1/3 and one at 2/3 of the scene
        const time1 = scene.start + sceneDuration / 3;
        const time2 = scene.start + (sceneDuration * 2) / 3;
        
        const frame1Path = path.join(outputDir, `keyframe_${scene.index}_0.jpg`);
        const frame2Path = path.join(outputDir, `keyframe_${scene.index}_1.jpg`);
        
        try {
          await Promise.all([
            exec(`ffmpeg -y -ss ${time1.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${frame1Path}"`),
            exec(`ffmpeg -y -ss ${time2.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${frame2Path}"`),
          ]);
          
          if (fs.existsSync(frame1Path) && fs.statSync(frame1Path).size > 0) {
            keyframes.push(frame1Path);
          }
          if (fs.existsSync(frame2Path) && fs.statSync(frame2Path).size > 0) {
            keyframes.push(frame2Path);
          }
        } catch (error) {
          console.error(`Error extracting keyframes for scene ${scene.index}:`, error);
        }
      }
    }

    // If no keyframes extracted, try extracting at scene start as fallback
    if (keyframes.length === 0) {
      const fallbackPath = path.join(outputDir, `keyframe_${scene.index}_fallback.jpg`);
      try {
        await exec(
          `ffmpeg -y -ss ${scene.start.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${fallbackPath}"`
        );
        if (fs.existsSync(fallbackPath) && fs.statSync(fallbackPath).size > 0) {
          keyframes.push(fallbackPath);
        }
      } catch (error) {
        console.error(`Error extracting fallback keyframe for scene ${scene.index}:`, error);
      }
    }

    return keyframes;
  }

  /**
   * Extract additional context frames at 1-2 fps for the entire video
   * This provides temporal context without over-sampling
   */
  private async extractContextFrames(
    videoPath: string,
    outputDir: string
  ): Promise<string[]> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const framePattern = path.join(outputDir, `context_frame_%04d.jpg`);

    // Extract frames at 1-2 fps for context
    await exec(
      `ffmpeg -y -i "${videoPath}" -vf "fps=${FRAME_SAMPLE_RATE},scale=640:360" "${framePattern}"`
    );

    // Get all extracted frame files, sorted
    const frameFiles = fs
      .readdirSync(outputDir)
      .filter((f) => f.startsWith("context_frame_") && f.endsWith(".jpg"))
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

    const prompt = `You are an expert video-understanding system that creates detailed, factual descriptions of video scenes optimized for semantic search and vector embeddings.

You are analyzing a video scene (a continuous segment with consistent content). Below are descriptions of keyframes extracted from this scene (1-2 representative frames):

${frameDescriptionsText}

Generate a comprehensive summary in 8-12 information-dense sentences that captures:

1. Core visual content:
   - All visible subjects, objects, and their attributes (colors, shapes, sizes, materials, textures)
   - Clothing, accessories, physical attributes, and distinguishing features
   - Spatial relationships and positioning (foreground/mid-ground/background)
   - Any text, graphics, overlays, or UI elements visible
   - Composition and visual arrangement

2. Environment and setting:
   - Location type (indoor/outdoor, room type, landscape, urban, natural environment)
   - Lighting conditions (natural, artificial, time of day, quality of light)
   - Background structure, depth, and atmospheric conditions
   - Weather or environmental conditions if visible

3. Actions and activities:
   - What is happening in the scene (actions, movements, interactions)
   - Direction and nature of any motion or activity
   - Gestures, poses, or body language
   - Interactions between subjects or with objects
   - State of activity (active, static, transitional)

4. Visual style and composition:
   - Overall visual style (realistic, stylized, animated, documentary, cinematic, etc.)
   - Camera perspective, angle, and framing
   - Any special effects, filters, or visual treatments
   - Color palette and mood

5. Semantic search categories:
   - Add 2-3 sentences about object categories, scene types, themes, actions, and use-case categories this scene represents
   - Include relevant keywords that would help someone find this content through search
   - Base this only on visible content in the keyframes

Style:
- Use natural, descriptive prose with rich visual detail
- Be specific and factual about what is visible
- Focus on the most distinctive and searchable elements
- Do not mention what is NOT in the scene
- Do not speculate about identity, emotions, or intent beyond what's visually apparent
- Prioritize factual visual observations that enable semantic search discovery`;

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

      requestId = response._request_id ?? undefined;
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
   * Process a single scene (replaces processChunk)
   */
  private async processScene(
    scene: { start: number; end: number; index: number },
    videoUrl: string,
    videoPath: string,
    tempDir: string,
    vectorDB: VectorDBService,
    userId: string,
    collectionName?: string
  ): Promise<{ chunkId: string; summary: string; start: number; end: number }> {
    const { start, end, index } = scene;
    
    // Step 1: Extract keyframes from scene (1-2 per scene)
    const framesDir = path.join(tempDir, `scene_${index}_frames`);
    const keyframeFiles = await this.extractKeyframesFromScene(videoPath, scene, framesDir);
    // Step 2: Upload keyframes to Cloudinary, get descriptions, then delete
    const frameDescriptions: string[] = [];

    for (const framePath of keyframeFiles) {
      // Upload to Cloudinary
      const { url: frameUrl, publicId } = await this.uploadFrameToCloudinary(framePath);

      // Get GPT description
      const description = await this.describeFrameWithGPT(frameUrl, userId, {
        videoUrl,
        chunkIndex: index,
        collectionName,
      });
      frameDescriptions.push(description);

      // Delete from Cloudinary
      await this.deleteFrameFromCloudinary(publicId);

      // Delete local frame file
      try {
        fs.unlinkSync(framePath);
      } catch {
        // Ignore cleanup errors
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

    console.log(`Scene ${index} indexed successfully (${start.toFixed(1)}s - ${end.toFixed(1)}s)`);

    // Clean up frames directory
    try {
      fs.rmSync(framesDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
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

      // Step 2: Detect scenes using FFmpeg scene detection
      const scenes = await this.detectScenes(videoPath);
      console.log(`\nDetected ${scenes.length} scenes (reduced from ~${Math.ceil((duration || 0) / CHUNK_SIZE_SECONDS)} fixed chunks)`);

      // Step 3: Process each scene
      const results: Array<{ chunkId: string; summary: string; start: number; end: number }> = [];
      const tempScenesDir = path.join(this.tempDir, uuidv4());

      for (const scene of scenes) {
        try {
          const result = await this.processScene(
            scene,
            videoUrl,
            videoPath,
            tempScenesDir,
            vectorDB,
            userId,
            collectionName
          );
          results.push(result);
        } catch (error) {
          console.error(`Error processing scene ${scene.index}:`, error);
        }
      }

      // Clean up scenes directory
      try {
        fs.rmSync(tempScenesDir, { recursive: true, force: true });
      } catch (error) {
        console.error("Error cleaning up scenes directory:", error);
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
   * Search videos across multiple collections using Promise.all
   * Results are grouped by videoUrl and returned as an object with videoUrl as key
   */
  async searchVideosMultipleCollections(
    query: string,
    userId: string,
    collections: string[],
    topK: number = 5
  ): Promise<Record<string, {
    videoUrl: string;
    videoId?: number;
    title?: string;
    duration?: number;
    resolution?: string;
    collectionName?: string;
    clips: Array<{
    id: string;
    score: number;
      startTime: string;
      endTime: string;
    }>;
    bestScore: number;
  }>> {
    if (collections.length === 0) {
      return {};
    }

    console.log(`Collections: ${collections}`);
    console.log(`Searching for query: ${query} in collections: ${collections}`);

    // Create search promises for each collection
    const searchPromises = collections.map(async (collectionName) => {
      try {
        const namespace = createCollectionNamespace(userId, collectionName, "video");
        const vectorDB = new VectorDBService(namespace, userId);
        
        // VectorDB.query() will generate and cache the embedding
        const results = await vectorDB.query(query, topK, 0.5);


        console.log(`Results: `, results.matches);

        if (results.matches.length > 0) {
        return results.matches.map((m) => ({
          id: m.id || "",
          score: m.score || 0,
          text: (m.metadata?.text as string) || "",
          videoUrl: m.metadata?.videoUrl as string | undefined,
          startTime: m.metadata?.startTime as string | undefined,
          endTime: m.metadata?.endTime as string | undefined,
          collectionName,
        }));
        }

        return [];
      } catch(error) {
        console.error(`Error searching for query: ${query} in collection: ${collectionName}`, error);
        return [];
      }
    });

    // Execute all searches in parallel
    const allResults = await Promise.all(searchPromises);
    console.log(`All results: ${allResults}`);
    // Flatten results
    const mergedResults = allResults.flat();


    // Group ALL clips by videoUrl - every clip with the same videoUrl goes into the same group
    const groupedByVideo = new Map<string, {
      videoUrl: string;
      collectionName?: string;
      clips: Array<{
        id: string;
        score: number;
        startTime: string;
        endTime: string;
      }>;
      bestScore: number;
      // Track unique clips to avoid duplicates within the same video
      uniqueClips: Set<string>; // Key: "startTime-endTime" or "id"
    }>();

    // Process all results and group by videoUrl
    for (const result of mergedResults) {
      // Skip results without videoUrl (they can't be grouped)
      if (!result.videoUrl) {
        continue;
      }

      // Use videoUrl as the grouping key - all clips from the same videoUrl go to the same group
      const videoKey = result.videoUrl;
      
      // Create group if it doesn't exist
      if (!groupedByVideo.has(videoKey)) {
        groupedByVideo.set(videoKey, {
          videoUrl: result.videoUrl,
          collectionName: result.collectionName,
          clips: [],
          bestScore: result.score,
          uniqueClips: new Set(),
        });
      }

      // Get the group for this videoUrl - ALL clips from this videoUrl are added here
      const group = groupedByVideo.get(videoKey)!;
      
      // Add clip to the group if it has valid timestamps
      if (result.startTime && result.endTime) {
        // Create a unique key for this clip: prefer ID if available, otherwise use time range
        const clipKey = result.id || `${result.startTime}-${result.endTime}`;
        
        // Only add if we haven't seen this exact clip before (deduplication)
        if (!group.uniqueClips.has(clipKey)) {
          group.uniqueClips.add(clipKey);
          // Add this clip to the video's clips array
          group.clips.push({
            id: result.id,
            score: result.score,
            startTime: result.startTime,
            endTime: result.endTime,
          });
        } else {
          // If duplicate clip found (same time range or ID), keep the one with better score
          const existingClip = group.clips.find(
            c => c.id === result.id || (c.startTime === result.startTime && c.endTime === result.endTime)
          );
          if (existingClip && result.score > existingClip.score) {
            existingClip.score = result.score;
            existingClip.id = result.id; // Update ID if available
          }
        }
      }

      // Update best score for this video group
      if (result.score > group.bestScore) {
        group.bestScore = result.score;
      }
    }

    // Convert Map to object structure with videoUrl as key
    const groupedResultsObject: Record<string, {
      videoUrl: string;
      videoId?: number;
      title?: string;
      description?: string;
      duration?: number;
      resolution?: string;
      collectionName?: string;
      clips: Array<{
        id: string;
        score: number;
        startTime: string;
        endTime: string;
      }>;
      bestScore: number;
    }> = {};

    // Remove the uniqueClips Set and convert to object
    for (const [videoUrl, group] of groupedByVideo.entries()) {
      const { uniqueClips, ...rest } = group;
      
      // Sort clips within each group by score (best matches first)
      rest.clips.sort((a, b) => b.score - a.score);
      
      groupedResultsObject[videoUrl] = rest;
    }

    // Sort video URLs by best score and limit to topK
    const sortedVideoUrls = Object.entries(groupedResultsObject)
      .sort(([, a], [, b]) => b.bestScore - a.bestScore)
      .slice(0, topK)
      .map(([videoUrl]) => videoUrl);

    // Return only the top K videos as an object
    const topResults: Record<string, typeof groupedResultsObject[string]> = {};
    for (const videoUrl of sortedVideoUrls) {
      topResults[videoUrl] = groupedResultsObject[videoUrl];
    }

    return topResults;
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


