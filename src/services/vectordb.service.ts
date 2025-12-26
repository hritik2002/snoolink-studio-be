import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { CONFIG } from "../config";
import { v4 as uuidv4 } from "uuid";
import { CostTrackingService } from "./costTracking.service";

export class VectorDBService {
  private db: Pinecone;
  private openaiClient: OpenAI;
  private namespace: string;
  private costTracker: CostTrackingService;
  private userId?: string;

  constructor(namespace: string, userId?: string) {
    this.namespace = namespace;
    this.userId = userId;
    this.db = new Pinecone({
      apiKey: CONFIG.pinecone.apiKey,
    });
    this.openaiClient = new OpenAI({
      apiKey: CONFIG.openai.apiKey,
    });
    this.costTracker = new CostTrackingService();
  }

  async upsert(text: string, metadata: Record<string, string | number | boolean | string[]>) {
    const embedding = await this.embed(text, "upsert");
    const id = uuidv4();
    await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .upsert([
        {
          id,
          values: embedding,
          metadata: metadata,
        },
      ]);

    return id;
  }

  async embed(text: string, operation: "upsert" | "query" = "query") {
    if (!this.userId) {
      // If no userId provided, skip cost tracking but still perform embedding
      const embedding = await this.openaiClient.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
      });
      return embedding.data[0].embedding;
    }

    const startTime = Date.now();
    let requestId: string | undefined;
    let success = true;
    let errorMessage: string | undefined;

    try {
      const response = await this.openaiClient.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
      });

      requestId = response.id;
      const responseTime = Date.now() - startTime;

      // Track cost
      await this.costTracker.trackEmbedding(
        {
          userId: this.userId,
          apiType: "embedding",
          model: "text-embedding-ada-002",
          operationType: "embedding",
          endpoint: operation === "upsert" ? "vector_upsert" : "vector_search",
          context: `${operation === "upsert" ? "Creating" : "Searching"} vector embedding`,
          metadata: {
            namespace: this.namespace,
            text_length: text.length,
            operation,
          },
          requestId,
          responseTimeMs: responseTime,
          success: true,
        },
        response.usage
      );

      return response.data[0].embedding;
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : "Unknown error";
      const responseTime = Date.now() - startTime;

      // Track failed call
      await this.costTracker.trackEmbedding(
        {
          userId: this.userId,
          apiType: "embedding",
          model: "text-embedding-ada-002",
          operationType: "embedding",
          endpoint: operation === "upsert" ? "vector_upsert" : "vector_search",
          context: `${operation === "upsert" ? "Creating" : "Searching"} vector embedding`,
          metadata: {
            namespace: this.namespace,
            text_length: text.length,
            operation,
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

  async query(text: string, topK: number = 5) {
    const embedding = await this.embed(text, "query");
    const result = await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .query({
        vector: embedding,
        topK,
        includeMetadata: true,
      });

    return result;
  }
}
