import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  port: process.env.PORT || 3001,
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
  embedding: {
    provider: "openai",
    model: "text-embedding-3-small",
    config: {},
  },
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY ?? "",
    index: process.env.PINECONE_INDEX ?? "snoolink",
    namespace: process.env.PINECONE_NAMESPACE ?? "images",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
  },
};
