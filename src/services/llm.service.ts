import { OpenAI } from "openai";
import ollama from "ollama";

export class LLMServices {
  private openaiClient: OpenAI;

  constructor() {
    this.openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async describeImage(imageUrl: string): Promise<string> {
    try {
      const response = await ollama.chat({
        model: "llava",
        messages: [
          {
            role: "user",
            content: "Describe this image in detail in plain text.",
            images: [imageUrl],
          },
        ],
      });
      const description = response.message.content.trim();
      return description;
    } catch (error) {
      console.error("Error describing image", error);
      throw error;
    }
  }
}
