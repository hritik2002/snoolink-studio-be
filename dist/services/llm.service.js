import { OpenAI } from "openai";
import { DESCRIBE_IMAGE_SYSTEM_PROMPT } from "../utils/constants";
export class LLMServices {
    openaiClient;
    constructor() {
        this.openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    async describeImage(imageUrl) {
        try {
            const response = await this.openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: DESCRIBE_IMAGE_SYSTEM_PROMPT,
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: imageUrl,
                                },
                            },
                        ],
                    },
                ],
            });
            return response.choices[0]?.message.content?.trim() || "";
        }
        catch (error) {
            console.error("Error describing image", error);
            throw error;
        }
    }
    async ask(query, systemPrompt) {
        const response = await this.openaiClient.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                {
                    role: "user",
                    content: query,
                },
            ],
        });
        return response.choices[0]?.message.content?.trim() || "";
    }
}
