import { OpenAI } from "openai";
import { DESCRIBE_IMAGE_SYSTEM_PROMPT } from "../utils/constants";
import { CostTrackingService } from "./costTracking.service";
import { getImageBufferFromS3Url } from "./s3.service";

export class LLMServices {
  private openaiClient: OpenAI;
  private costTracker: CostTrackingService;

  constructor() {
    this.openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.costTracker = new CostTrackingService();
  }

  async describeImage(
    imageUrl: string,
    userId: string,
    metadata?: { collectionName?: string; resourceType?: string; endpoint?: string },
    customPrompt?: string
  ): Promise<string> {
    const startTime = Date.now();
    let requestId: string | undefined;
    let success = true;
    let errorMessage: string | undefined;
    const textPrompt = customPrompt || DESCRIBE_IMAGE_SYSTEM_PROMPT;

    try {
      // For S3 URLs, fetch via backend credentials and pass as base64 so OpenAI can use it
      // (avoids 400/403 when bucket is private or URL is not publicly reachable)
      let urlForOpenAI = imageUrl;
      const s3Buffer = await getImageBufferFromS3Url(imageUrl);
      if (s3Buffer) {
        urlForOpenAI = `data:image/png;base64,${s3Buffer.toString("base64")}`;
      }

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
                image_url: {
                  url: urlForOpenAI,
                },
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
          operationType: "image_description",
          endpoint: metadata?.endpoint,
          context: "Image description for semantic search",
          metadata: {
            collection_name: metadata?.collectionName,
            resource_type: metadata?.resourceType,
            image_url: imageUrl,
          },
          requestId,
          responseTimeMs: responseTime,
          success: true,
        },
        response.usage,
        1 // 1 image
      );

      return response.choices[0]?.message.content?.trim() || "";
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
          operationType: "image_description",
          endpoint: metadata?.endpoint,
          context: "Image description for semantic search",
          metadata: {
            collection_name: metadata?.collectionName,
            resource_type: metadata?.resourceType,
            image_url: imageUrl,
          },
          requestId,
          responseTimeMs: responseTime,
          success: false,
          errorMessage,
        },
        undefined,
        1
      );

      console.error("Error describing image", error);
      throw error;
    }
  }

  async ask(
    query: string,
    systemPrompt: string,
    userId: string,
    operationType: "query_expansion" | "video_summary" | "other" = "other",
    metadata?: { endpoint?: string; context?: string; [key: string]: any }
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
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: query,
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
          operationType,
          endpoint: metadata?.endpoint,
          context: metadata?.context || "LLM query",
          metadata: {
            ...metadata,
            query_length: query.length,
            system_prompt_length: systemPrompt.length,
          },
          requestId,
          responseTimeMs: responseTime,
          success: true,
        },
        response.usage
      );

      return response.choices[0]?.message.content?.trim() || "";
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
          operationType,
          endpoint: metadata?.endpoint,
          context: metadata?.context || "LLM query",
          metadata: {
            ...metadata,
            query_length: query.length,
            system_prompt_length: systemPrompt.length,
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
}
