import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  port: process.env.PORT || 3000,
  supabase: {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseKey: process.env.SUPABASE_KEY || "",
  },
  cloudinary: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
    api_key: process.env.CLOUDINARY_API_KEY || "",
    api_secret: process.env.CLOUDINARY_API_SECRET || "",
    secure: true,
  },
  vectordb: {
    type: "chroma",
    config: {
      dir: "./vdb",
      storeName: "images",
      embedderConfig: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY || "",
        model: "text-embedding-3-small",
      },
    },
  },
  vlm: {
    provider: "ollama",
    model: "llava",
    config: {},
  },
  embedding: {
    provider: "openai",
    model: "text-embedding-3-small",
    config: {},
  },
};
