import { EXPAND_QUERY_SYSTEM_PROMPT } from "../utils/constants";
import { createCollectionNamespace } from "../utils/namespace";
import { LLMServices } from "./llm.service";
import { VectorDBService } from "./vectordb.service";

/** Synonyms for common query terms so "red shirt guy" matches descriptions with "red cardigan" and "man". */
const LEXICAL_SYNONYMS: Record<string, string[]> = {
  shirt: ["cardigan", "top", "sweater", "blouse", "jacket", "tee", "tshirt"],
  guy: ["man", "male", "person", "boy"],
  woman: ["lady", "female", "person", "girl"],
  hat: ["cap", "beanie", "headwear"],
  dress: ["gown", "outfit"],
};
const LEXICAL_BOOST_PER_MATCH = 0.065;
const LEXICAL_BOOST_CAP = 0.2;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Boosts score when query terms (or their synonyms) appear in the description text.
 * Helps short colloquial queries like "red shirt guy" match "man in red cardigan".
 */
function computeLexicalBoost(query: string, text: string): number {
  if (!text || !query) return 0;
  const t = text.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  let boost = 0;
  for (const w of words) {
    const syns = LEXICAL_SYNONYMS[w] || [];
    const toCheck = [w, ...syns];
    if (toCheck.some((term) => new RegExp(`\\b${escapeRe(term)}\\b`, "i").test(t))) {
      boost += LEXICAL_BOOST_PER_MATCH;
    }
  }
  return Math.min(LEXICAL_BOOST_CAP, boost);
}

/**
 * Parses "Search keywords: w1, w2, ..." from the end of a description.
 * If present, returns mainDesc (without that line) and embedText (Keywords: ... . mainDesc).
 * Otherwise returns both as the original description.
 */
function parseDescriptionWithKeywords(description: string): { mainDesc: string; embedText: string } {
  const lines = description.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  const m = last.match(/^Search keywords:\s*(.+)$/i);
  if (m) {
    const keywords = m[1].trim();
    const mainDesc = lines.slice(0, -1).join("\n").trim() || description;
    const embedText = `Keywords: ${keywords}. ${mainDesc}`;
    return { mainDesc, embedText };
  }
  return { mainDesc: description, embedText: description };
}

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
    metadata?: { collectionName?: string; resourceType?: string; endpoint?: string },
    customPrompt?: string
  ): Promise<string> {
    return this.llmClient.describeImage(imageUrl, userId, metadata, customPrompt);
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
  }): Promise<{ id: string; description: string }> {
    const { mainDesc, embedText } = parseDescriptionWithKeywords(description);
    const db = this.getCollectionVectorDB(userId, collectionName);
    const id = await db.upsert(embedText, {
      imageUrl,
      description: mainDesc,
      text: mainDesc,
      resourceType: "image",
    });
    return { id: id ?? "", description: mainDesc };
  }

  // Legacy single-namespace search (now uses collection namespace)
  async searchImages({
    query,
    userId,
    topK = 5,
    collectionName,
    minScore = 0.5,
  }: {
    query: string;
    userId: string;
    topK?: number;
    collectionName: string;
    minScore?: number;
  }) {
    try {
      const db = this.getCollectionVectorDB(userId, collectionName);
      const queryResult = await db.query(query, topK, minScore);
      const textKey = "text" as const;

      const results = queryResult.matches
        .map((m) => {
          const base = m.score || 0;
          const text = (m.metadata?.[textKey] as string) || "";
          const boost = computeLexicalBoost(query, text);
          return { id: m.id || "", score: Math.min(1, base + boost), imageUrl: (m.metadata?.imageUrl as string) ?? "" };
        })
        .sort((a, b) => b.score - a.score);

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
    minScore = 0.5,
  }: {
    query: string;
    userId: string;
    collections: string[];
    topK?: number;
    minScore?: number;
  }): Promise<SearchResult[]> {
    if (collections.length === 0) {
      return [];
    }

    const textKey = "text" as const;

    // Create search promises for each collection
    const searchPromises = collections.map(async (collectionName) => {
      try {
        const db = this.getCollectionVectorDB(userId, collectionName);
        const results = await db.query(query, topK, minScore);

        if (results.matches.length > 0) {
          return results.matches.map((m) => {
            const base = m.score ?? 0;
            const text = (m.metadata?.[textKey] as string) || "";
            const boost = computeLexicalBoost(query, text);
            return {
              id: m.id,
              score: Math.min(1, base + boost),
              imageUrl: (m.metadata?.imageUrl as string) ?? "",
              collectionName,
            };
          });
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

  async expandQuery(
    userMessage: string,
    userId: string,
    endpoint?: string,
    systemPrompt?: string
  ): Promise<string> {
    const expanded = await this.llmClient.ask(
      userMessage,
      systemPrompt || EXPAND_QUERY_SYSTEM_PROMPT,
      userId,
      "query_expansion",
      { endpoint, context: "Query expansion for semantic search" }
    );
    // Strip common prefixes the model may add (e.g. "Expanded: ", "Expanded query: ")
    const cleaned = expanded.replace(
      /^(Expanded(?:\s+query)?|Query expansion):\s*/i,
      ""
    ).trim();
    
    console.log(`\n🔄 [QUERY EXPANSION]`);
    console.log(`Original: "${userMessage.slice(0, 80)}..."`);
    console.log(`Expanded: "${cleaned}"`);
    console.log(`Expansion ratio: ${cleaned.length / Math.max(1, userMessage.length)}x\n`);
    
    return cleaned;
  }
}
