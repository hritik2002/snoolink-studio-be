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
    // Optimize OpenAI client with timeouts and retry limits
    this.openaiClient = new OpenAI({
      apiKey: CONFIG.openai.apiKey,
      timeout: 30000, // 30s timeout
      maxRetries: 2, // Reduce retries for faster failures
    });
    this.costTracker = new CostTrackingService();
  }

  /**
   * Hash text for cache key generation
   */
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
    // Cache embeddings for queries (not upserts) to avoid re-computing
    if (operation === "query") {
      const cacheKey = `embedding:${this.hashText(text)}`;
      const cached = await redisService.get<number[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    if (!this.userId) {
      // If no userId provided, skip cost tracking but still perform embedding
      const embedding = await this.openaiClient.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
      });
      const result = embedding.data[0].embedding;
      
      // Cache query embeddings for 24 hours
      if (operation === "query") {
        const cacheKey = `embedding:${this.hashText(text)}`;
        await redisService.set(cacheKey, result, 86400); // 24 hours
      }
      
      return result;
    }

    const startTime = Date.now();
    let requestId: string | undefined;
    let success = true;
    let errorMessage: string | undefined;

    try {
      const response = await this.openaiClient.embeddings.create({
        model: "text-embedding-3-small", // or "text-embedding-3-large"
        input: text,
      });

      requestId = response._request_id ?? undefined;
      const responseTime = Date.now() - startTime;
      const embedding = response.data[0].embedding;

      // Cache query embeddings for 24 hours
      if (operation === "query") {
        const cacheKey = `embedding:${this.hashText(text)}`;
        await redisService.set(cacheKey, embedding, 86400); // 24 hours
      }

      // Track cost
      await this.costTracker.trackEmbedding(
        {
          userId: this.userId,
          apiType: "embedding",
          model: "text-embedding-ada-002",
          operationType: "embedding",
          endpoint: operation === "upsert" ? "vector_upsert" : "vector_search",
          context: `${
            operation === "upsert" ? "Creating" : "Searching"
          } vector embedding`,
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
          context: `${
            operation === "upsert" ? "Creating" : "Searching"
          } vector embedding`,
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

  /**
   * Get embedding for a query (with caching)
   * Useful for parallel operations where we need the embedding separately
   */
  async getEmbedding(text: string): Promise<number[]> {
    return this.embed(text, "query");
  }

  /**
   * Query with timeout protection
   */
  async query(text: string, topK: number = 5, minScore: number = 0.7) {
    return Promise.race([
      this.performQuery(text, topK, minScore),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout after 5s")), 5000)
      ),
    ]);
  }

  /**
   * Perform the actual query operation
   */
  private async performQuery(
    text: string,
    topK: number,
    minScore: number
  ) {
    const embedding = await this.embed(text, "query");
    const result = await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .query({
        vector: embedding,
        topK: topK * 2, // Fetch more to filter
        includeMetadata: true,
      });

    // Filter results by minimum score
    const filteredMatches = result.matches.filter(
      (m) => (m.score || 0) >= minScore
    );

    return {
      ...result,
      matches: filteredMatches.slice(0, topK), // Return top K after filtering
    };
  }

  /**
   * Query using a pre-computed embedding (for parallel operations)
   * This avoids re-embedding when we already have the embedding
   */
  async queryWithEmbedding(
    embedding: number[],
    topK: number = 5,
    minScore: number = 0.7
  ) {
    return Promise.race([
      this.performQueryWithEmbedding(embedding, topK, minScore),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout after 5s")), 5000)
      ),
    ]);
  }

  /**
   * Perform query with pre-computed embedding
   */
  private async performQueryWithEmbedding(
    embedding: number[],
    topK: number,
    minScore: number
  ) {
    console.log(`[vectordb] Querying namespace: ${this.namespace}, topK: ${topK}, minScore: ${minScore}`);
    const result = await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .query({
        vector: embedding,
        topK: topK * 2, // Fetch more to filter
        includeMetadata: true,
      });

    console.log(`[vectordb] Raw results from Pinecone: ${result.matches.length} matches`);
    if (result.matches.length > 0) {
      const scores = result.matches.map(m => m.score?.toFixed(3)).join(", ");
      console.log(`[vectordb] Score range: ${scores}`);
    }

    // Filter results by minimum score
    const filteredMatches = result.matches.filter(
      (m) => (m.score || 0) >= minScore
    );

    console.log(`[vectordb] After minScore filter (${minScore}): ${filteredMatches.length} matches`);

    return {
      ...result,
      matches: filteredMatches.slice(0, topK), // Return top K after filtering
    };
  }
}
