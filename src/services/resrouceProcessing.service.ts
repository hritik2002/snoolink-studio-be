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
    collectionName,
  }: {
    description: string;
    imageUrl: string;
    userId: string;
    collectionName: string;
  }): Promise<string> {
    // Use collection-based namespace
    const db = this.getCollectionVectorDB(userId, collectionName);
    const id = await db.upsert(description, {
      imageUrl,
      description,
    });
    return id ?? "";
  }

  // Legacy single-namespace search (now uses collection namespace)
  async searchImages({
    query,
    userId,
    topK = 5,
    embedding,
    collectionName,
  }: {
    query: string;
    userId: string;
    topK?: number;
    embedding?: number[];
    collectionName: string;
  }) {
    try {
      const db = this.getCollectionVectorDB(userId, collectionName);
      
      let results: Array<{
        id: string;
        score: number;
        imageUrl: string;
      }> = [];

      if (embedding) {
        const queryResult = await db.queryWithEmbedding(embedding, topK * 3, 0.5);
        results = queryResult.matches.map((m) => ({
          id: m.id || "",
          score: m.score || 0,
          imageUrl: (m.metadata?.imageUrl as string) ?? "",
        }));
      } else {
        const queryResult = await db.query(query, topK * 3, 0.5);
        results = queryResult.matches.map((m) => ({
          id: m.id || "",
          score: m.score || 0,
          imageUrl: (m.metadata?.imageUrl as string) ?? "",
        }));
      }

      // If no results, try legacy namespace for backward compatibility
      if (results.length === 0) {
        try {
          const legacyDb = this.getVectorDB(userId);
          const legacyResults = embedding
            ? await legacyDb.queryWithEmbedding(embedding, topK * 3, 0.5)
            : await legacyDb.query(query, topK * 3, 0.5);

          return legacyResults.matches.map((m) => ({
            id: m.id || "",
            score: m.score ?? 0,
            imageUrl: (m.metadata?.imageUrl as string) ?? "",
          }));
        } catch {
          return [];
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Get embedding for a query (for parallel operations)
   * Uses the first collection's namespace to get embedding (embedding itself doesn't depend on namespace)
   */
  async getEmbedding(query: string, userId: string, collectionName: string): Promise<number[]> {
    const db = this.getCollectionVectorDB(userId, collectionName);
    return db.getEmbedding(query);
  }

  /**
   * Search across multiple collections using Promise.all
   * Results are merged and sorted by score
   */
  async searchMultipleCollections({
    query,
    userId,
    collections,
    topK = 5,
    embedding,
  }: {
    query: string;
    userId: string;
    collections: string[];
    topK?: number;
    embedding?: number[];
  }): Promise<SearchResult[]> {
    if (collections.length === 0) {
      return [];
    }

    // Pre-compute embedding once if not provided, using first collection
    let queryEmbedding: number[];
    if (embedding) {
      queryEmbedding = embedding;
    } else {
      queryEmbedding = await this.getCollectionVectorDB(userId, collections[0]).getEmbedding(query);
    }

    // Track if we've already tried the legacy namespace
    let legacySearched = false;
    let legacyResults: SearchResult[] = [];

    // Create search promises for each collection
    const searchPromises = collections.map(async (collectionName) => {
      try {
        const db = this.getCollectionVectorDB(userId, collectionName);
        const results = await db.queryWithEmbedding(queryEmbedding, topK * 3, 0.5);

        if (results.matches.length > 0) {
          return results.matches.map((m) => ({
            id: m.id,
            score: m.score ?? 0,
            imageUrl: (m.metadata?.imageUrl as string) ?? "",
            collectionName,
          }));
        }

        return [];
      } catch {
        return [];
      }
    });

    // Execute all searches in parallel
    const allResults = await Promise.allSettled(searchPromises);

    // Flatten and merge results
    const mergedResults: SearchResult[] = allResults
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => (r as PromiseFulfilledResult<SearchResult[]>).value);

    // If no results from collection namespaces, try legacy namespace once
    if (mergedResults.length === 0 && !legacySearched) {
      legacySearched = true;
      try {
        const legacyDb = this.getVectorDB(userId);
        const legacyQueryResults = await legacyDb.queryWithEmbedding(queryEmbedding, topK * 3, 0.5);
        legacyResults = legacyQueryResults.matches.map((m) => ({
          id: m.id,
          score: m.score ?? 0,
          imageUrl: (m.metadata?.imageUrl as string) ?? "",
          collectionName: collections[0], // Assign to first collection
        }));
      } catch {
        // Legacy search failed, continue with empty results
      }
    }

    // Combine collection results with legacy results
    const combinedResults = [...mergedResults, ...legacyResults];

    // Sort by score descending
    combinedResults.sort((a, b) => b.score - a.score);

    // Return top K results
    return combinedResults.slice(0, topK);
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
