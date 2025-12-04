import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { CONFIG } from "../config";
import { v4 as uuidv4 } from "uuid";
export class VectorDBService {
    db;
    openaiClient;
    constructor() {
        this.db = new Pinecone({
            apiKey: CONFIG.pinecone.apiKey,
        });
        this.openaiClient = new OpenAI({
            apiKey: CONFIG.openai.apiKey,
        });
    }
    async upsert(text, metadata) {
        const embedding = await this.embed(text);
        const id = uuidv4();
        await this.db
            .index(CONFIG.pinecone.index)
            .namespace(CONFIG.pinecone.namespace)
            .upsert([
            {
                id,
                values: embedding,
                metadata: metadata,
            },
        ]);
        return id;
    }
    async embed(text) {
        const embedding = await this.openaiClient.embeddings.create({
            model: "text-embedding-ada-002",
            input: text,
        });
        return embedding.data[0].embedding;
    }
    async query(text, topK = 5) {
        const embedding = await this.embed(text);
        const result = await this.db
            .index(CONFIG.pinecone.index)
            .namespace(CONFIG.pinecone.namespace)
            .query({
            vector: embedding,
            topK,
            includeMetadata: true,
        });
        return result;
    }
}
