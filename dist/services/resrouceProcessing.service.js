import { EXPAND_QUERY_SYSTEM_PROMPT } from "../utils/constants";
import { LLMServices } from "./llm.service";
import { VectorDBService } from "./vectordb.service";
export class ResourceProcessingService {
    db;
    llmClient;
    constructor() {
        this.db = new VectorDBService();
        this.llmClient = new LLMServices();
    }
    async describeImage(imageUrl) {
        return this.llmClient.describeImage(imageUrl);
    }
    async embedImage({ description, imageUrl, }) {
        const id = await this.db.upsert(description, {
            imageUrl,
            description,
        });
        return id ?? "";
    }
    async searchImages({ query, topK = 5 }) {
        const results = await this.db.query(query, topK).then((res) => res.matches.map((m) => ({
            id: m.id,
            score: m.score,
            text: m.metadata?.description ?? "",
            imageUrl: m.metadata?.imageUrl ?? "",
        })));
        return results;
    }
    async expandQuery(query) {
        return this.llmClient.ask(query, EXPAND_QUERY_SYSTEM_PROMPT);
    }
}
