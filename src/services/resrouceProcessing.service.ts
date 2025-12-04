import { EXPAND_QUERY_SYSTEM_PROMPT } from "../utils/constants";
import { LLMServices } from "./llm.service";
import { VectorDBService } from "./vectordb.service";

export class ResourceProcessingService {
  private db: VectorDBService;
  private llmClient: LLMServices;
  constructor() {
    this.db = new VectorDBService();

    this.llmClient = new LLMServices();
  }

  async describeImage(imageUrl: string): Promise<string> {
    return this.llmClient.describeImage(imageUrl);
  }

  async embedImage({
    description,
    imageUrl,
  }: {
    description: string;
    imageUrl: string;
  }): Promise<string> {
    const id = await this.db.upsert(description, {
      imageUrl,
      description,
    });
    return id ?? "";
  }

  async searchImages({ query, topK = 5 }: { query: string; topK?: number }) {
    const results = await this.db.query(query, topK).then((res) =>
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
