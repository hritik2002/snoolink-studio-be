import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { CONFIG } from "../config";
import { v4 as uuidv4 } from "uuid";
import { CostTrackingService } from "./costTracking.service";
import { redisService } from "./redis.service";
import crypto from "crypto";

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
      timeout: 30000,
      maxRetries: 2,
    });
    this.costTracker = new CostTrackingService();
  }

  private hashText(text: string): string {
    return crypto
      .createHash("md5")
      .update(text.toLowerCase().trim())
      .digest("hex");
  }

  async upsert(
    text: string,
    metadata: Record<string, string | number | boolean | string[]>
  ) {
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
    if (operation === "query") {
      const cacheKey = `embedding:${this.hashText(text)}`;
      const cached = await redisService.get<number[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    if (!this.userId) {
      const embedding = await this.openaiClient.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
      });
      const result = embedding.data[0].embedding;
      
      if (operation === "query") {
        const cacheKey = `embedding:${this.hashText(text)}`;
        await redisService.set(cacheKey, result, 86400);
      }
      
      return result;
    }

    const startTime = Date.now();
    let requestId: string | undefined;

    try {
      const response = await this.openaiClient.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });

      requestId = response._request_id ?? undefined;
      const responseTime = Date.now() - startTime;
      const embedding = response.data[0].embedding;

      if (operation === "query") {
        const cacheKey = `embedding:${this.hashText(text)}`;
        await redisService.set(cacheKey, embedding, 86400);
      }

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

      return embedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const responseTime = Date.now() - startTime;

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

  async getEmbedding(text: string): Promise<number[]> {
    return this.embed(text, "query");
  }

  async query(text: string, topK: number = 5, minScore: number = 0.5) {
    return Promise.race([
      this.performQuery(text, topK, minScore),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout after 5s")), 5000)
      ),
    ]);
  }

  private async performQuery(text: string, topK: number, minScore: number) {
    const embedding = await this.embed(text, "query");
    const result = await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .query({
        vector: embedding,
        topK: topK * 2,
        includeMetadata: true,
      });

    const filteredMatches = result.matches.filter(
      (m) => (m.score || 0) >= minScore
    );

    return {
      ...result,
      matches: filteredMatches.slice(0, topK),
    };
  }

  async queryWithEmbedding(
    embedding: number[],
    topK: number = 5,
    minScore: number = 0.5
  ) {
    return Promise.race([
      this.performQueryWithEmbedding(embedding, topK, minScore),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout after 5s")), 5000)
      ),
    ]);
  }

  private async performQueryWithEmbedding(
    embedding: number[],
    topK: number,
    minScore: number
  ) {
    const result = await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .query({
        vector: embedding,
        topK: topK * 2,
        includeMetadata: true,
      });

    const filteredMatches = result.matches.filter(
      (m) => (m.score || 0) >= minScore
    );

    return {
      ...result,
      matches: filteredMatches.slice(0, topK),
    };
  }
}
