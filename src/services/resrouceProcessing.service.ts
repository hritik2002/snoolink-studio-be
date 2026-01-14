import { EXPAND_QUERY_SYSTEM_PROMPT } from "../utils/constants";
import { createCollectionNamespace } from "../utils/namespace";
import { LLMServices } from "./llm.service";
import { VectorDBService } from "./vectordb.service";

interface SearchResult {
  id: string;
  score: number;
  imageUrl: string;
  collectionName?: string;
}

export class ResourceProcessingService {
  private llmClient: LLMServices;

  constructor() {
    this.llmClient = new LLMServices();
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
    collectionName,
  }: {
    query: string;
    userId: string;
    topK?: number;
    collectionName: string;
  }) {
    try {
      const db = this.getCollectionVectorDB(userId, collectionName);
      
      // VectorDB.query() will generate and cache the embedding
      const queryResult = await db.query(query, topK, 0.5);
      
      const results = queryResult.matches.map((m) => ({
        id: m.id || "",
        score: m.score || 0,
        imageUrl: (m.metadata?.imageUrl as string) ?? "",
      }));

      return results;
    } catch {
      return [];
    }
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
  }: {
    query: string;
    userId: string;
    collections: string[];
    topK?: number;
  }): Promise<SearchResult[]> {
    if (collections.length === 0) {
      return [];
    }

    // Create search promises for each collection
    const searchPromises = collections.map(async (collectionName) => {
      try {
        const db = this.getCollectionVectorDB(userId, collectionName);
        // VectorDB.query() will generate and cache the embedding
        const results = await db.query(query, topK, 0.5);

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

    // Sort by score descending
    mergedResults.sort((a, b) => b.score - a.score);

    // Return top K results
    return mergedResults.slice(0, topK);
  }

  async expandQuery(query: string, userId: string, endpoint?: string): Promise<string> {
    const expanded = await this.llmClient.ask(
      query,
      EXPAND_QUERY_SYSTEM_PROMPT,
      userId,
      "query_expansion",
      { endpoint, context: "Query expansion for semantic search" }
    );
    
    console.log(`\n🔄 [QUERY EXPANSION]`);
    console.log(`Original: "${query}"`);
    console.log(`Expanded: "${expanded}"`);
    console.log(`Expansion ratio: ${expanded.length / query.length}x\n`);
    
    return expanded;
  }
}
