import dotenv from "dotenv";
// Only load .env file in development (when file exists)
// In production (Railway, etc.), environment variables are injected by the platform
if (process.env.NODE_ENV !== "production") {
    dotenv.config();
}
// Validate required environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl) {
    console.error("SUPABASE_URL is required", supabaseUrl);
    throw new Error("SUPABASE_URL is required. Please set it in your .env file.");
}
if (!supabaseKey) {
    console.error("SUPABASE_KEY is required", supabaseKey);
    throw new Error("SUPABASE_KEY is required. Please set it in your .env file. " +
        "This should be the SERVICE ROLE key from Supabase Dashboard → Settings → API");
}
export const CONFIG = {
    port: process.env.PORT || 3001,
    supabase: {
        supabaseUrl,
        supabaseKey,
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
