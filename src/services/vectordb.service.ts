import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { CONFIG } from "../config";
import { v4 as uuidv4 } from "uuid";
import { CostTrackingService } from "./costTracking.service";
import { redisService } from "./redis.service";
import crypto from "crypto";

const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * VectorDB uses text-embedding-3-small for all embeddings.
 * Ensure the Pinecone index is configured with cosine similarity metric
 * (set in Pinecone dashboard when creating the index).
 */
export class VectorDBService {
  private db: Pinecone;
  private openaiClient: OpenAI;
  private namespace: string;
  private costTracker: CostTrackingService;
  private userId: string;

  constructor(namespace: string, userId: string) {
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

    const startTime = Date.now();
    let requestId: string | undefined;

    try {
      const response = await this.openaiClient.embeddings.create({
        model: EMBEDDING_MODEL,
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
          model: EMBEDDING_MODEL,
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
          model: EMBEDDING_MODEL,
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

  /**
   * Query vector database
   * @param textOrEmbedding - Query text or pre-computed embedding
   * @param topK - Number of results to return
   * @param minScore - Minimum similarity score threshold (0.5 default)
   */
  async query(
    text: string,
    topK: number = 5,
    minScore: number = 0.5
  ) {
    // Longer timeout to account for embedding generation + Pinecone query
    return Promise.race([
      this.performQuery(text, topK, minScore),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout after 30s")), 30000)
      ),
    ]);
  }

  private async performQuery(
    text: string,
    topK: number,
    minScore: number
  ) {
    const startTime = Date.now();
    
    const embedding = await this.embed(text, "query");
    
    const embeddingTime = Date.now() - startTime;
    
    console.log(`\n🔍 [SEARCH DEBUG] ==================`);
    console.log(`Query: "${text.substring(0, 150)}..."`);
    console.log(`Namespace: ${this.namespace}`);
    console.log(`Embedding time: ${embeddingTime}ms`);
    console.log(`Requesting topK: ${topK * 3}, minScore filter: ${minScore}`);

    // Fetch more results than needed to account for filtering
    const fetchTopK = topK * 3;

    const result = await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .query({
        vector: embedding,
        topK: fetchTopK,
        includeMetadata: true,
      });

    console.log(`\n📊 Raw Pinecone Results (${result.matches.length}):`);
    result.matches.slice(0, 5).forEach((m, idx) => {
      console.log(`  ${idx + 1}. Score: ${(m.score || 0).toFixed(4)} | ID: ${m.id?.substring(0, 40)}`);
      const text = m.metadata?.text as string;
      if (text) {
        console.log(`     Preview: ${text.substring(0, 100)}...`);
      }
    });

    // Filter by minimum score threshold
    const filteredMatches = result.matches.filter(
      (m) => (m.score || 0) >= minScore
    ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); // Sort by score descending

    console.log(`\n✅ After filtering (score >= ${minScore}): ${filteredMatches.length} results`);
    if (filteredMatches.length > 0) {
      console.log(`   Best score: ${filteredMatches[0].score?.toFixed(4)}`);
      console.log(`   Worst score: ${filteredMatches[filteredMatches.length - 1].score?.toFixed(4)}`);
    }
    console.log(`🔍 [SEARCH DEBUG] ==================\n`);

    // Return only the requested number of results
    return {
      ...result,
      matches: filteredMatches.slice(0, topK),
    };
  }
}
