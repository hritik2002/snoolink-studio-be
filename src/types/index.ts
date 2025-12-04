export type CloudinaryConfig = {
  cloud_name: string;
  api_key: string;
  api_secret: string;
  secure: boolean;
};

export type VectorDBConfig = {
  type: "chroma" | "pinecone" | "local";
  config: {};
};

export type VLMConfig = {
  provider: "openai" | "dashscope";
  model: "llava" | "gpt-4-vision" | "qwen-vl-plus";
  config: {};
};

export type EmbeddingConfig = {
  provider: "openai" | "xenova";
  model: "text-embedding-3-small";
  config: {};
  api_key: string;
  api_secret: string;
  secure: boolean;
};