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

  // Legacy single-namespace search (now uses collection namespace)
  async searchImages({
    query,
    userId,
    topK = 5,
    embedding, // Optional pre-computed embedding
    collectionName = "Default",
  }: {
    query: string;
    userId: string;
    topK?: number;
    embedding?: number[]; // Optional pre-computed embedding
    collectionName?: string;
  }) {
    try {
      // Use collection-based namespace (not legacy)
      const db = this.getCollectionVectorDB(userId, collectionName);
      
      // Use pre-computed embedding if provided, otherwise query normally
      let results: Array<{
        id: string;
        score: number;
        imageUrl: string;
      }> = [];

      if (embedding) {
        // Use lower minScore (0.5) and fetch more results like video search
        const queryResult = await db.queryWithEmbedding(embedding, topK * 3, 0.5);
        console.log(`[image-search] Single collection search: Found ${queryResult.matches.length} results (scores: ${queryResult.matches.map(m => m.score?.toFixed(3)).join(", ") || "none"})`);
        results = queryResult.matches.map((m) => ({
          id: m.id || "",
          score: m.score || 0,
          imageUrl: (m.metadata?.imageUrl as string) ?? "",
        }));
      } else {
        // Use lower minScore (0.5) and fetch more results
        const queryResult = await db.query(query, topK * 3, 0.5);
        console.log(`[image-search] Single collection search: Found ${queryResult.matches.length} results (scores: ${queryResult.matches.map(m => m.score?.toFixed(3)).join(", ") || "none"})`);
        results = queryResult.matches.map((m) => ({
          id: m.id || "",
          score: m.score || 0,
          imageUrl: (m.metadata?.imageUrl as string) ?? "",
        }));
      }

      // If no results in collection namespace and searching "Default", try legacy namespace
      if (results.length === 0 && collectionName === "Default") {
        console.log(
          `No results in collection namespace for Default, trying legacy namespace...`
        );
        try {
          const legacyDb = this.getVectorDB(userId); // Legacy namespace: user-{userId}-images
          const legacyNamespace = createUserNamespace(userId, "image");
          console.log(`[image-search] Trying legacy namespace: ${legacyNamespace}`);
          const legacyResults = embedding
            ? await legacyDb.queryWithEmbedding(embedding, topK * 3, 0.5)
            : await legacyDb.query(query, topK * 3, 0.5);
          console.log(`[image-search] Legacy namespace: Found ${legacyResults.matches.length} results`);

          return legacyResults.matches.map((m) => ({
            id: m.id || "",
            score: m.score ?? 0,
            imageUrl: (m.metadata?.imageUrl as string) ?? "",
          }));
        } catch (legacyError) {
          console.error(`Error searching legacy namespace:`, legacyError);
          // Return empty results if legacy search also fails
          return [];
        }
      }

      return results;
    } catch (error) {
      console.error(`Error in searchImages for collection ${collectionName}:`, error);
      // Return empty array on error instead of throwing
      return [];
    }
  }

  /**
   * Get embedding for a query (for parallel operations)
   * Uses Default collection namespace to get embedding
   */
  async getEmbedding(query: string, userId: string): Promise<number[]> {
    const db = this.getCollectionVectorDB(userId, "Default");
    const namespace = createCollectionNamespace(userId, "Default", "image");
    console.log(`[image-search] Getting embedding for query "${query}" using namespace: ${namespace}`);
    const embedding = await db.getEmbedding(query);
    console.log(`[image-search] Embedding generated, length: ${embedding.length}`);
    return embedding;
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

    console.log(`[image-search] searchMultipleCollections called with collections: [${collections.join(", ")}], topK: ${topK}, hasEmbedding: ${!!embedding}`);

    // Pre-compute embedding once if not provided
    let queryEmbedding: number[];
    if (embedding) {
      queryEmbedding = embedding;
      console.log(`[image-search] Using provided embedding, length: ${embedding.length}`);
    } else {
      const firstCollection = collections[0];
      const namespace = createCollectionNamespace(userId, firstCollection, "image");
      console.log(`[image-search] Computing embedding using first collection "${firstCollection}" (namespace: ${namespace})`);
      queryEmbedding = await this.getCollectionVectorDB(userId, firstCollection).getEmbedding(query);
      console.log(`[image-search] Embedding computed, length: ${queryEmbedding.length}`);
    }

    // Create search promises for each collection using pre-computed embedding
    const searchPromises = collections.map(async (collectionName) => {
      try {
        // Use collection-based namespace
        const db = this.getCollectionVectorDB(userId, collectionName);
        const namespace = createCollectionNamespace(userId, collectionName, "image");
        console.log(`[image-search] Searching collection "${collectionName}" in namespace: ${namespace}`);
        
        // Use lower minScore (0.5) and fetch more results (topK * 3) like video search
        const results = await db.queryWithEmbedding(queryEmbedding, topK * 3, 0.5);
        
        console.log(`[image-search] Collection "${collectionName}": Found ${results.matches.length} results (scores: ${results.matches.map(m => m.score?.toFixed(3)).join(", ") || "none"})`);

        // If no results in collection namespace, try legacy namespace for backward compatibility
        // Try for ALL collections, not just "Default", in case data is in legacy namespace
        if (results.matches.length === 0) {
          console.log(
            `[image-search] No results in collection namespace "${collectionName}", trying legacy namespace...`
          );
          try {
            const legacyDb = this.getVectorDB(userId); // Legacy namespace: user-{userId}-images
            const legacyNamespace = createUserNamespace(userId, "image");
            console.log(`[image-search] Searching legacy namespace: ${legacyNamespace}`);
            const legacyResults = await legacyDb.queryWithEmbedding(
              queryEmbedding,
              topK * 3,
              0.5 // Lower minScore
            );
            console.log(`[image-search] Legacy namespace: Found ${legacyResults.matches.length} results`);
            if (legacyResults.matches.length > 0) {
              return legacyResults.matches.map((m) => ({
                id: m.id,
                score: m.score ?? 0,
                imageUrl: (m.metadata?.imageUrl as string) ?? "",
                collectionName, // Keep original collection name even though data is from legacy
              }));
            }
          } catch (legacyError) {
            console.error(`[image-search] Error searching legacy namespace:`, legacyError);
          }
        }

        return results.matches.map((m) => ({
          id: m.id,
          score: m.score ?? 0,
          imageUrl: (m.metadata?.imageUrl as string) ?? "",
          collectionName,
        }));
      } catch (error) {
        console.error(`[image-search] Error searching collection ${collectionName}:`, error);
        return []; // Return empty array on error to not fail the entire search
      }
    });

    // Execute all searches in parallel with Promise.allSettled for resilience
    const allResults = await Promise.allSettled(searchPromises);

    // Log results from each collection
    allResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        console.log(`[image-search] Collection "${collections[index]}": ${result.value.length} results`);
      } else {
        console.error(`[image-search] Collection "${collections[index]}" failed:`, result.reason);
      }
    });

    // Flatten and merge results, handling both fulfilled and rejected promises
    const mergedResults: SearchResult[] = allResults
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => (r as PromiseFulfilledResult<SearchResult[]>).value);

    console.log(`[image-search] Total merged results before sorting: ${mergedResults.length}`);

    // Sort by score descending
    mergedResults.sort((a, b) => b.score - a.score);

    const finalResults = mergedResults.slice(0, topK);
    console.log(`[image-search] Final results after sorting and limiting to ${topK}: ${finalResults.length}`);
    if (finalResults.length > 0) {
      console.log(`[image-search] Score range: ${finalResults.map(r => r.score.toFixed(3)).join(", ")}`);
    }

    // Return top K results across all collections
    return finalResults;
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
