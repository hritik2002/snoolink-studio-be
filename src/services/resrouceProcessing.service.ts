import uploadToCloudinary from "./cloudinary.service";
import { LLMServices } from "./llm.service";
import { VectorDB } from "@hritik2002/local-vectordb";

export class ResourceProcessingService {
  private db: VectorDB;
  private llmClient: LLMServices;
  constructor() {
    this.db = new VectorDB({
      dir: "./vdb",
      storeName: "images",
      embedderConfig: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: "text-embedding-3-small",
      },
    });

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
    return this.db.upsert(description, {
      metadata: {
        imageUrl,
        description,
      },
    });
  }

  async searchImages({ query, topK = 5 }: { query: string; topK?: number }) {
    const results = await this.db.query({ query, topK });
    return results;
  }
}
