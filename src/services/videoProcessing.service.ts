import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { OpenAI } from "openai";
import { CONFIG } from "../config";
import { DESCRIBE_VIDEO_FRAME_PROMPT } from "../utils/constants";
import { VectorDBService } from "./vectordb.service";
import { createCollectionNamespace } from "../utils/namespace";
import { CostTrackingService } from "./costTracking.service";
import uploadToS3, { deleteFromS3, extractS3KeyFromUrl, getBufferFromOurUrl } from "./s3.service";
import util from "util";
import child_process from "child_process";
import axios from "axios";

const exec = util.promisify(child_process.exec);

const CHUNK_SIZE_SECONDS = 5; // Legacy - kept for fallback
const SCENE_DETECTION_THRESHOLD = 0.2; // FFmpeg scene detection sensitivity (0.0-1.0, lower = more sensitive) - lowered for better detection
const KEYFRAMES_PER_SCENE = 2; // Extract 1-2 keyframes per scene
const FRAME_SAMPLE_RATE = 1.5; // Sample at 1-2 fps for additional context
const MAX_SCENE_DURATION = 10; // If scene is longer than this, sample at regular intervals (seconds)
const KEYFRAME_INTERVAL = 4; // Extract keyframe every N seconds for long scenes (finer for moment-level recall)

// --- 95% moment-accuracy: finer temporal indexing ---
/** Half-window (seconds) around each keyframe for moment-level clips. ±1s => 2s clips. */
const KEYFRAME_MOMENT_WINDOW_SECONDS = 1;
/** Emit per-keyframe embeddings (narrow 2s windows) in addition to scene-level. Enables exact-moment retrieval. */
const EMIT_KEYFRAME_LEVEL_EMBEDDINGS = true;
/** For long scenes: also emit dense 3–4s segment embeddings (reuses keyframe descriptions). Improves recall for moments between keyframes. */
const EMIT_DENSE_SEGMENT_EMBEDDINGS = true;
/** Min scene length (seconds) to emit dense segments. Avoids overlap with keyframe-level for short scenes. */
const DENSE_SEGMENT_MIN_SCENE_DURATION = 8;
/** Dense segment length in seconds. Shorter = finer moments, more vectors. */
const DENSE_SEGMENT_SECONDS = 3;

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
   * Download video from URL to temporary file.
   * For our S3/CDN URLs, fetches via S3 GetObject (backend IAM) to avoid CloudFront 403.
   */
  private async downloadVideo(videoUrl: string): Promise<string> {
    const videoPath = path.join(this.tempDir, `video_${uuidv4()}.mp4`);

    const ourBuffer = await getBufferFromOurUrl(videoUrl);
    if (ourBuffer !== null) {
      await fs.promises.writeFile(videoPath, ourBuffer);
      return videoPath;
    }

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
   * Cleanup a directory and all its contents
   */
  private async cleanupDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        await fs.promises.unlink(filePath);
      }
      await fs.promises.rmdir(dirPath);
    } catch (error) {
      // Ignore cleanup errors
    }
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
   * Detect scene changes using frame extraction and analysis
   * More reliable than FFmpeg's scene filter which doesn't always work
   * Returns array of scene boundaries in seconds
   */
  private async detectScenes(videoPath: string): Promise<Array<{ start: number; end: number; index: number }>> {
    const tempSceneDir = path.join(this.tempDir, `scene_detection_${uuidv4()}`);
    
    try {
      // Get video duration first
      const duration = await this.getVideoDuration(videoPath);
      console.log(`Analyzing video for scene changes (duration: ${duration.toFixed(1)}s)...`);

      // Create temp directory for frame extraction
      await fs.promises.mkdir(tempSceneDir, { recursive: true });

      // METHOD 1: Extract frames at regular intervals for analysis
      // Extract 1 frame per second for scene detection
      const frameSampleRate = 1; // 1 fps
      const totalFrames = Math.ceil(duration * frameSampleRate);
      
      console.log(`Extracting ${totalFrames} sample frames for scene analysis...`);
      
      // Extract frames at 1fps
      await exec(
        `ffmpeg -i "${videoPath}" -vf "fps=${frameSampleRate},scale=320:240" -q:v 2 "${tempSceneDir}/frame_%04d.jpg"`
      );

      // Get list of extracted frames
      const frameFiles = await fs.promises.readdir(tempSceneDir);
      const sortedFrames = frameFiles.filter(f => f.endsWith('.jpg')).sort();
      
      console.log(`Extracted ${sortedFrames.length} frames for analysis`);

      if (sortedFrames.length === 0) {
        throw new Error("No frames extracted for scene detection");
      }

      // METHOD 2: Compare consecutive frames using FFmpeg's ssim (structural similarity)
      // to find significant visual changes
      const sceneChangeTimes: number[] = [0]; // Always start at 0
      const sceneChangeThreshold = 0.3; // Lower SSIM score = more different (0-1 scale)
      
      console.log("Comparing frames to detect scene changes...");
      
      for (let i = 0; i < sortedFrames.length - 1; i++) {
        const frame1 = path.join(tempSceneDir, sortedFrames[i]);
        const frame2 = path.join(tempSceneDir, sortedFrames[i + 1]);
        
        try {
          // Use FFmpeg to compare frames with SSIM filter
          const { stderr } = await exec(
            `ffmpeg -i "${frame1}" -i "${frame2}" -lavfi "ssim=stats_file=-" -f null - 2>&1 || true`
          );
          
          // Parse SSIM score from output
          // Lower SSIM means frames are more different (potential scene change)
          const ssimMatch = stderr.match(/All:([\d.]+)/);
          if (ssimMatch) {
            const ssimScore = parseFloat(ssimMatch[1]);
            
            // If SSIM score is low (frames are different), mark as potential scene change
            if (ssimScore < 1.0 - sceneChangeThreshold) {
              const timestamp = (i + 1) / frameSampleRate; // Convert frame index to time
              sceneChangeTimes.push(timestamp);
              console.log(`Scene change detected at ${timestamp.toFixed(1)}s (SSIM: ${ssimScore.toFixed(3)})`);
            }
          }
        } catch (compareError) {
          // Skip frame comparison errors
          continue;
        }
      }

      console.log(`Found ${sceneChangeTimes.length - 1} scene changes via frame comparison`);

      // METHOD 3: If SSIM comparison failed or found too few scenes, use deterministic 10-second-boundary rule
      if (sceneChangeTimes.length <= 2 && sortedFrames.length > 2) {
        console.log("Trying deterministic 10-second-boundary scene detection...");
        
        for (let i = 0; i < sortedFrames.length; i++) {
          const timestamp = (i + 1) / frameSampleRate;
          const prevTimestamp = i / frameSampleRate;
          if (
            Math.floor(timestamp / 10) > Math.floor(prevTimestamp / 10) &&
            !sceneChangeTimes.includes(timestamp)
          ) {
            sceneChangeTimes.push(timestamp);
          }
        }
        sceneChangeTimes.sort((a, b) => a - b);
        console.log(`10s-boundary detection added scenes, total: ${sceneChangeTimes.length - 1}`);
      }

      // METHOD 4: If still too few scenes, force intelligent breaks
      if (sceneChangeTimes.length <= 2) {
        console.log("⚠️  Still too few scenes detected, using intelligent interval-based detection...");
        
        // For videos < 60s: break every 8-10 seconds
        // For videos >= 60s: break every 10-15 seconds
        const intervalSeconds = duration < 60 ? 8 : 12;
        
        sceneChangeTimes.length = 1; // Reset to just [0]
        let currentTime = intervalSeconds;
        
        while (currentTime < duration) {
          sceneChangeTimes.push(currentTime);
          currentTime += intervalSeconds;
        }
        
        console.log(`Created ${sceneChangeTimes.length - 1} intelligent scene breaks at ${intervalSeconds}s intervals`);
      }

      // Add end time
      sceneChangeTimes.push(duration);
      
      // Remove duplicates, sort, and filter out timestamps too close together
      const uniqueChanges = [...new Set(sceneChangeTimes)].sort((a, b) => a - b);
      const minSceneGap = 2.0; // Minimum 2 seconds between scene changes
      const filteredChanges: number[] = [0];
      
      for (let i = 1; i < uniqueChanges.length; i++) {
        if (uniqueChanges[i] - filteredChanges[filteredChanges.length - 1] >= minSceneGap) {
          filteredChanges.push(uniqueChanges[i]);
        }
      }
      
      console.log(`Scene change timestamps (after filtering): ${filteredChanges.map(t => t.toFixed(1)).join(', ')}`);

      // Create scene segments
      const scenes: Array<{ start: number; end: number; index: number }> = [];
      let index = 0;

      for (let i = 0; i < filteredChanges.length - 1; i++) {
        scenes.push({
          start: filteredChanges[i],
          end: filteredChanges[i + 1],
          index: index++,
        });
      }

      // Calculate statistics
      const fixedChunksCount = Math.ceil(duration / CHUNK_SIZE_SECONDS);
      const reduction = fixedChunksCount > 0 
        ? Math.round((1 - scenes.length / fixedChunksCount) * 100)
        : 0;
      
      const avgSceneDuration = scenes.length > 0 
        ? (scenes.reduce((sum, s) => sum + (s.end - s.start), 0) / scenes.length).toFixed(1)
        : duration.toFixed(1);

      console.log(`✅ Detected ${scenes.length} scenes (avg ${avgSceneDuration}s each, ${reduction}% reduction from ${fixedChunksCount} fixed chunks)`);
      
      // Cleanup temp directory
      await this.cleanupDirectory(tempSceneDir);
      
      return scenes;
    } catch (error) {
      console.error("❌ Scene detection failed, falling back to fixed chunks:", error);
      
      // Cleanup temp directory
      try {
        await this.cleanupDirectory(tempSceneDir);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
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
   * Extract keyframes from a scene with timestamps for moment-level indexing.
   * For short scenes: 1-2 keyframes (1/3, 2/3 or middle).
   * For long scenes (>MAX_SCENE_DURATION): samples every KEYFRAME_INTERVAL seconds.
   * Returns { path, time }[] so each keyframe can be indexed with precise [start,end] for exact-moment retrieval.
   */
  private async extractKeyframesFromScene(
    videoPath: string,
    scene: { start: number; end: number; index: number },
    outputDir: string
  ): Promise<Array<{ path: string; time: number }>> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const sceneDuration = scene.end - scene.start;
    const keyframes: Array<{ path: string; time: number }> = [];

    // For long scenes, sample at regular intervals instead of just 1-2 keyframes
    if (sceneDuration > MAX_SCENE_DURATION) {
      const numKeyframes = Math.ceil(sceneDuration / KEYFRAME_INTERVAL);
      const keyframeTimes: number[] = [];
      for (let i = 0; i < numKeyframes; i++) {
        const time = scene.start + (i * KEYFRAME_INTERVAL) + (KEYFRAME_INTERVAL / 2);
        if (time < scene.end) keyframeTimes.push(time);
      }
      if (keyframeTimes.length === 0 || keyframeTimes[keyframeTimes.length - 1] < scene.end - 1) {
        keyframeTimes.push(scene.end - 0.5);
      }
      console.log(`Scene ${scene.index} is ${sceneDuration.toFixed(1)}s long - extracting ${keyframeTimes.length} keyframes at intervals`);

      const extractionPromises = keyframeTimes.map(async (t, idx) => {
        const framePath = path.join(outputDir, `keyframe_${scene.index}_${idx}.jpg`);
        try {
          await exec(`ffmpeg -y -ss ${t.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${framePath}"`);
          if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) return { path: framePath, time: t };
        } catch (err) {
          console.error(`Error extracting keyframe ${idx} for scene ${scene.index} at ${t.toFixed(1)}s:`, err);
        }
        return null;
      });
      const results = await Promise.all(extractionPromises);
      for (const r of results) if (r) keyframes.push(r);
    } else {
      if (KEYFRAMES_PER_SCENE >= 2) {
        const time1 = scene.start + sceneDuration / 3;
        const time2 = scene.start + (sceneDuration * 2) / 3;
        const frame1Path = path.join(outputDir, `keyframe_${scene.index}_0.jpg`);
        const frame2Path = path.join(outputDir, `keyframe_${scene.index}_1.jpg`);
        try {
          await Promise.all([
            exec(`ffmpeg -y -ss ${time1.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${frame1Path}"`),
            exec(`ffmpeg -y -ss ${time2.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${frame2Path}"`),
          ]);
          if (fs.existsSync(frame1Path) && fs.statSync(frame1Path).size > 0) keyframes.push({ path: frame1Path, time: time1 });
          if (fs.existsSync(frame2Path) && fs.statSync(frame2Path).size > 0) keyframes.push({ path: frame2Path, time: time2 });
        } catch (err) {
          console.error(`Error extracting keyframes for scene ${scene.index}:`, err);
        }
      } else {
        const middleTime = scene.start + sceneDuration / 2;
        const framePath = path.join(outputDir, `keyframe_${scene.index}_0.jpg`);
        try {
          await exec(`ffmpeg -y -ss ${middleTime.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${framePath}"`);
          if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) {
            keyframes.push({ path: framePath, time: middleTime });
          } else {
            console.warn(`Failed to extract keyframe for scene ${scene.index} at ${middleTime.toFixed(1)}s`);
          }
        } catch (err) {
          console.error(`Error extracting keyframe for scene ${scene.index}:`, err);
        }
      }
    }

    if (keyframes.length === 0) {
      const fallbackPath = path.join(outputDir, `keyframe_${scene.index}_fallback.jpg`);
      try {
        await exec(`ffmpeg -y -ss ${scene.start.toFixed(3)} -i "${videoPath}" -vframes 1 -vf "scale=640:360" -q:v 2 "${fallbackPath}"`);
        if (fs.existsSync(fallbackPath) && fs.statSync(fallbackPath).size > 0) {
          keyframes.push({ path: fallbackPath, time: scene.start });
        }
      } catch (err) {
        console.error(`Error extracting fallback keyframe for scene ${scene.index}:`, err);
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
   * Upload frame to S3 and get URL
   */
  private async uploadFrameToS3(framePath: string): Promise<{
    url: string;
    key: string;
  }> {
    const url = await uploadToS3(framePath, "image");
    const key = extractS3KeyFromUrl(url) || "";

    return {
      url,
      key,
    };
  }

  /**
   * Delete frame from S3
   */
  private async deleteFrameFromS3(key: string): Promise<void> {
    try {
      await deleteFromS3(key);
      console.log(`Deleted frame from S3: ${key}`);
    } catch (error) {
      console.error(`Error deleting frame ${key}:`, error);
    }
  }

  /**
   * Get GPT vision description of a frame using S3 URL
   */
  private async describeFrameWithGPT(
    frameUrl: string,
    userId: string,
    metadata?: { videoUrl?: string; chunkIndex?: number; collectionName?: string },
    customPrompt?: string
  ): Promise<string> {
    const textPrompt = customPrompt || DESCRIBE_VIDEO_FRAME_PROMPT;
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
                text: textPrompt,
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
    metadata?: { videoUrl?: string; chunkIndex?: number; collectionName?: string },
    customPrompt?: string
  ): Promise<string> {
    const frameDescriptionsText = frameDescriptions
      .map((desc, idx) => `Frame ${idx + 1}: ${desc}`)
      .join("\n\n");

    const prompt = customPrompt
      ? `${customPrompt}\n\nYou are analyzing a video scene. Below are keyframe descriptions:\n\n${frameDescriptionsText}\n\nGenerate a comprehensive summary in 8-12 information-dense sentences optimized for semantic search.`
      : `You are an expert video-understanding system that creates detailed, factual descriptions of video scenes optimized for semantic search and vector embeddings.

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
   * Merge overlapping clips for the same video: keep higher-scoring; when scores are within 0.02,
   * prefer the shorter (more precise) moment. Reduces redundant scene/keyframe/dense overlaps.
   */
  private mergeOverlappingClips<T extends { score: number; startTime: string; endTime: string }>(clips: T[]): T[] {
    if (clips.length <= 1) return clips;
    const sorted = [...clips].sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.02) return b.score - a.score;
      const durA = parseFloat(a.endTime) - parseFloat(a.startTime);
      const durB = parseFloat(b.endTime) - parseFloat(b.startTime);
      return durA - durB; // prefer shorter (= more precise moment)
    });
    const kept: T[] = [];
    for (const c of sorted) {
      const s = parseFloat(c.startTime);
      const e = parseFloat(c.endTime);
      const overlaps = kept.some((k) => {
        const ks = parseFloat(k.startTime);
        const ke = parseFloat(k.endTime);
        return s < ke && e > ks;
      });
      if (!overlaps) kept.push(c);
    }
    return kept;
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
    collectionName?: string,
    ingestionPrompt?: string
  ): Promise<{ chunkId: string; summary: string; start: number; end: number }> {
    const { start, end, index } = scene;
    
    // Step 1: Extract keyframes from scene (with timestamps for moment-level indexing)
    const framesDir = path.join(tempDir, `scene_${index}_frames`);
    const keyframeData = await this.extractKeyframesFromScene(videoPath, scene, framesDir);

    // Step 2: Upload keyframes to S3, get GPT descriptions, build { desc, time }[]
    const frameDescriptions: { desc: string; time: number }[] = [];
    for (const kf of keyframeData) {
      const { url: frameUrl, key } = await this.uploadFrameToS3(kf.path);
      const description = await this.describeFrameWithGPT(frameUrl, userId, {
        videoUrl,
        chunkIndex: index,
        collectionName,
      }, ingestionPrompt);
      frameDescriptions.push({ desc: description, time: kf.time });
      await this.deleteFrameFromS3(key);
      try { fs.unlinkSync(kf.path); } catch { /* ignore */ }
    }

    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch (e) { console.error(`Error removing frames dir:`, e); }

    // Step 3: Generate scene-level summary from frame descriptions
    const summary = await this.generateClipSummary(
      frameDescriptions.map((f) => f.desc),
      userId,
      { videoUrl, chunkIndex: index, collectionName },
      ingestionPrompt
    );
    console.log(`Clip summary: ${summary.substring(0, 150)}...`);

    // Step 4: Embed and store — scene-level + optional keyframe-level + optional dense segments

    // 4a) Scene-level embedding (primary chunk for backward compat)
    const chunkId = await vectorDB.upsert(summary, {
      videoUrl,
      startTime: start.toFixed(3),
      endTime: end.toFixed(3),
      resourceType: "video",
      segmentType: "scene",
      text: summary,
    });

    // 4b) Keyframe-level embeddings: ±KEYFRAME_MOMENT_WINDOW_SECONDS around each keyframe for exact-moment retrieval
    if (EMIT_KEYFRAME_LEVEL_EMBEDDINGS && frameDescriptions.length > 0) {
      for (const f of frameDescriptions) {
        const startM = Math.max(start, f.time - KEYFRAME_MOMENT_WINDOW_SECONDS);
        const endM = Math.min(end, f.time + KEYFRAME_MOMENT_WINDOW_SECONDS);
        await vectorDB.upsert(f.desc, {
          videoUrl,
          startTime: startM.toFixed(3),
          endTime: endM.toFixed(3),
          resourceType: "video",
          segmentType: "keyframe",
          text: f.desc,
        });
      }
    }

    // 4c) Dense segment embeddings: for long scenes, non-overlapping DENSE_SEGMENT_SECONDS windows;
    //     reuses keyframe descriptions (pick closest by time to segment center). No extra GPT calls.
    if (EMIT_DENSE_SEGMENT_EMBEDDINGS && (end - start) >= DENSE_SEGMENT_MIN_SCENE_DURATION && frameDescriptions.length > 0) {
      let segStart = start;
      while (segStart < end) {
        const segEnd = Math.min(segStart + DENSE_SEGMENT_SECONDS, end);
        const center = (segStart + segEnd) / 2;
        const best = frameDescriptions.reduce((a, b) =>
          Math.abs(a.time - center) <= Math.abs(b.time - center) ? a : b
        );
        await vectorDB.upsert(best.desc, {
          videoUrl,
          startTime: segStart.toFixed(3),
          endTime: segEnd.toFixed(3),
          resourceType: "video",
          segmentType: "dense",
          text: best.desc,
        });
        segStart = segEnd;
      }
    }

    const parts = ["scene"];
    if (EMIT_KEYFRAME_LEVEL_EMBEDDINGS) parts.push("keyframe");
    if (EMIT_DENSE_SEGMENT_EMBEDDINGS && (end - start) >= DENSE_SEGMENT_MIN_SCENE_DURATION) parts.push("dense");
    console.log(`Scene ${index} indexed (${parts.join("+")}) (${start.toFixed(1)}s - ${end.toFixed(1)}s)`);
    return { chunkId, summary, start, end };
  }

  /**
   * Process video from URL and index all chunks
   */
  async processAndIndexVideo(
    videoUrl: string, 
    userId: string,
    collectionName: string = "Default",
    ingestionPrompt?: string
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
            collectionName,
            ingestionPrompt
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
    topK: number = 5,
    minScore: number = 0.5
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
        
        // Request more vector matches (topK*5) to support moment-level clips (scene+keyframe+dense)
        const results = await vectorDB.query(query, Math.max(topK * 5, 20), minScore);


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
      
      // Sort clips by score (best first), then merge overlapping clips to prefer precise moments
      rest.clips.sort((a, b) => b.score - a.score);
      rest.clips = this.mergeOverlappingClips(rest.clips);

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


