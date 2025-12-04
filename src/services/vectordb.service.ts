import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { CONFIG } from "../config";
import { v4 as uuidv4 } from "uuid";

export class VectorDBService {
  private db: Pinecone;
  private openaiClient: OpenAI;
  private namespace: string;
  constructor(namespace: string) {
    this.namespace = namespace;
    this.db = new Pinecone({
      apiKey: CONFIG.pinecone.apiKey,
    });
    this.openaiClient = new OpenAI({
      apiKey: CONFIG.openai.apiKey,
    });
  }

  async upsert(text: string, metadata: Record<string, string | number | boolean | string[]>) {
    const embedding = await this.embed(text);
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

  async embed(text: string) {
    const embedding = await this.openaiClient.embeddings.create({
      model: "text-embedding-ada-002",
      input: text,
    });
    return embedding.data[0].embedding;
  }

  async query(text: string, topK: number = 5) {
    const embedding = await this.embed(text);
    const result = await this.db
      .index(CONFIG.pinecone.index)
      .namespace(this.namespace)
      .query({
        vector: embedding,
        topK,
        includeMetadata: true,
      });

    return result;
  }
}
