import { EXPAND_QUERY_SYSTEM_PROMPT } from "../utils/constants";
import { createUserNamespace } from "../utils/namespace";
import { LLMServices } from "./llm.service";
import { VectorDBService } from "./vectordb.service";

export class ResourceProcessingService {
  private db: VectorDBService | null = null;
  private llmClient: LLMServices;
  private currentUserId: string | null = null;

  constructor() {
    this.llmClient = new LLMServices();
  }

  // Get or create VectorDBService for a specific user
  private getVectorDB(userId: string): VectorDBService {
    if (!this.db || this.currentUserId !== userId) {
      const namespace = createUserNamespace(userId);
      this.db = new VectorDBService(namespace);
      this.currentUserId = userId;
    }
    return this.db;
  }

  async describeImage(imageUrl: string): Promise<string> {
    return this.llmClient.describeImage(imageUrl);
  }

  async embedImage({
    description,
    imageUrl,
    userId,
  }: {
    description: string;
    imageUrl: string;
    userId: string;
  }): Promise<string> {
    const db = this.getVectorDB(userId);
    const id = await db.upsert(description, {
      imageUrl,
      description,
    });
    return id ?? "";
  }

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
        text: m.metadata?.description ?? "",
        imageUrl: m.metadata?.imageUrl ?? "",
      }))
    );
    return results;
  }

  async expandQuery(query: string): Promise<string> {
    return this.llmClient.ask(query, EXPAND_QUERY_SYSTEM_PROMPT);
  }
}
