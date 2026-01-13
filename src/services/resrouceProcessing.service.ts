import { EXPAND_QUERY_SYSTEM_PROMPT } from "../utils/constants";
import { createUserNamespace, createCollectionNamespace } from "../utils/namespace";
import { LLMServices } from "./llm.service";
import { VectorDBService } from "./vectordb.service";

interface SearchResult {
  id: string;
  score: number;
  imageUrl: string;
  collectionName?: string;
}

export class ResourceProcessingService {
  private db: VectorDBService | null = null;
  private llmClient: LLMServices;
  private currentUserId: string | null = null;

  constructor() {
    this.llmClient = new LLMServices();
  }

  // Get or create VectorDBService for a specific user (images namespace - legacy)
  private getVectorDB(userId: string): VectorDBService {
    if (!this.db || this.currentUserId !== userId) {
      const namespace = createUserNamespace(userId, "image");
      this.db = new VectorDBService(namespace, userId);
      this.currentUserId = userId;
    }
    return this.db;
  }

  // Get VectorDBService for a specific collection (images)
  private getCollectionVectorDB(userId: string, collectionName: string): VectorDBService {
    const namespace = createCollectionNamespace(userId, collectionName, "image");
    return new VectorDBService(namespace, userId);
  }

  async describeImage(
    imageUrl: string,
    userId: string,
    metadata?: { collectionName?: string; resourceType?: string; endpoint?: string }
  ): Promise<string> {
    return this.llmClient.describeImage(imageUrl, userId, metadata);
  }

  async embedImage({
    description,
    imageUrl,
    userId,
    collectionName = "Default",
  }: {
    description: string;
    imageUrl: string;
    userId: string;
    collectionName?: string;
  }): Promise<string> {
    // Use collection-based namespace
    const db = this.getCollectionVectorDB(userId, collectionName);
    const id = await db.upsert(description, {
      imageUrl,
      description,
    });
    return id ?? "";
  }

  // Legacy single-namespace search
  async searchImages({
    query,
    userId,
    topK = 5,
  }: {
    query: string;
    userId: string;
    topK?: number;
  }) {
    const db = this.getVectorDB(userId);
    const results = await db.query(query, topK).then((res) =>
      res.matches.map((m) => ({
        id: m.id,
        score: m.score,
        imageUrl: m.metadata?.imageUrl ?? "",
      }))
    );
    return results;
  }

  /**
   * Get embedding for a query (for parallel operations)
   */
  async getEmbedding(query: string, userId: string): Promise<number[]> {
    const db = this.getCollectionVectorDB(userId, "Default");
    return db.getEmbedding(query);
  }

  /**
   * Search across multiple collections using Promise.all
   * Results are merged and sorted by score
   * Optimized to use pre-computed embeddings for parallel searches
   */
  async searchMultipleCollections({
    query,
    userId,
    collections,
    topK = 5,
    embedding, // Optional pre-computed embedding
  }: {
    query: string;
    userId: string;
    collections: string[];
    topK?: number;
    embedding?: number[]; // Optional pre-computed embedding
  }): Promise<SearchResult[]> {
    if (collections.length === 0) {
      return [];
    }

    console.log("collections", collections);

    // Pre-compute embedding once if not provided
    const queryEmbedding =
      embedding ||
      (await this.getCollectionVectorDB(userId, collections[0]).getEmbedding(
        query
      ));

    // Create search promises for each collection using pre-computed embedding
    const searchPromises = collections.map(async (collectionName) => {
      try {
        // Use collection-based namespace
        const db = this.getCollectionVectorDB(userId, collectionName);
        const results = await db.queryWithEmbedding(queryEmbedding, topK);

        // If searching "Default" and no results, also try legacy namespace for backward compatibility
        if (collectionName === "Default" && results.matches.length === 0) {
          console.log(
            `No results in new namespace for Default, trying legacy namespace...`
          );
          try {
            const legacyDb = this.getVectorDB(userId); // Legacy namespace: user-{userId}-images
            const legacyResults = await legacyDb.queryWithEmbedding(
              queryEmbedding,
              topK
            );
            return legacyResults.matches.map((m) => ({
              id: m.id,
              score: m.score ?? 0,
              imageUrl: (m.metadata?.imageUrl as string) ?? "",
              collectionName,
            }));
          } catch (legacyError) {
            console.error(`Error searching legacy namespace:`, legacyError);
          }
        }

        return results.matches.map((m) => ({
          id: m.id,
          score: m.score ?? 0,
          imageUrl: (m.metadata?.imageUrl as string) ?? "",
          collectionName,
        }));
      } catch (error) {
        console.error(`Error searching collection ${collectionName}:`, error);
        return []; // Return empty array on error to not fail the entire search
      }
    });

    // Execute all searches in parallel with Promise.allSettled for resilience
    const allResults = await Promise.allSettled(searchPromises);

    // Flatten and merge results, handling both fulfilled and rejected promises
    const mergedResults: SearchResult[] = allResults
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => (r as PromiseFulfilledResult<SearchResult[]>).value);

    // Sort by score descending
    mergedResults.sort((a, b) => b.score - a.score);

    // Return top K results across all collections
    return mergedResults.slice(0, topK);
  }

  async expandQuery(query: string, userId: string, endpoint?: string): Promise<string> {
    return this.llmClient.ask(
      query,
      EXPAND_QUERY_SYSTEM_PROMPT,
      userId,
      "query_expansion",
      { endpoint, context: "Query expansion for semantic search" }
    );
  }
}
