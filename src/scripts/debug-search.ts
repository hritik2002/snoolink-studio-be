/**
 * End-to-end search debugger — traces Redis, OpenAI, Pinecone, and service layers.
 * Usage: NODE_ENV=production tsx src/scripts/debug-search.ts "your query" [userId]
 */
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import Redis from "ioredis";
import { SupabaseService } from "../services/supabaseService";
import { ResourceProcessingService } from "../services/resourceProcessing.service";
import { VideoProcessingService } from "../services/videoProcessing.service";
import { createCollectionNamespace } from "../utils/namespace";
import { CONFIG } from "../config";

const QUERY = process.argv[2] || "a rocket launch video going into space";
const TOP_K = 10;
const EXPAND_QUERY = true;

function section(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function getSearchCacheKey(
  userId: string,
  query: string,
  collections: string[],
  topK: number,
  type: "image" | "video",
  expandQuery: boolean,
  minScore: number
) {
  const sortedCollections = [...collections].sort().join(",");
  const queryHash = crypto
    .createHash("md5")
    .update(query.toLowerCase().trim())
    .digest("hex")
    .substring(0, 16);
  const expandSuffix = expandQuery ? "" : ":noexpand";
  return `search:${type}:${userId}:${queryHash}:${sortedCollections}:${topK}${expandSuffix}:m${minScore.toFixed(2)}`;
}

async function main() {
  section("CONFIG");
  console.log("Query:", QUERY);
  console.log("Pinecone index:", CONFIG.pinecone.index);
  console.log("OpenAI key present:", !!CONFIG.openai.apiKey, "(length:", CONFIG.openai.apiKey.length, ")");
  console.log("Redis host:", CONFIG.redis.host);

  const supabase = new SupabaseService();
  const resourceService = new ResourceProcessingService();
  const videoService = new VideoProcessingService();

  // Pick user: CLI arg or first user with video vectors in Pinecone
  let userId = process.argv[3];
  if (!userId) {
    const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
    const stats = await pc.index(CONFIG.pinecone.index).describeIndexStats();
    const videoNs = Object.keys(stats.namespaces || {}).filter((n) => n.includes("-video-"));
    if (videoNs.length > 0) {
      userId = videoNs[0].split("-video-")[0];
      console.log("Auto-selected userId from Pinecone:", userId);
    } else {
      throw new Error("No video namespaces found and no userId provided");
    }
  }

  section("STEP 1 — User collections (Supabase)");
  let collections: { name: string; imageCount: number; videoCount: number }[] = [];
  try {
    collections = await supabase.getCollections(userId);
    console.log("Collections:", JSON.stringify(collections, null, 2));
  } catch (e: any) {
    console.error("Failed to fetch collections:", e.message);
  }

  const collectionNames = collections.map((c) => c.name);
  if (collectionNames.length === 0) {
    console.log("No collections — would return empty results");
    return;
  }

  section("STEP 2 — User search settings (Supabase)");
  let minScore = 0.5;
  try {
    const settings = await supabase.getUserModelSettings(userId);
    minScore =
      settings.min_score != null && !Number.isNaN(settings.min_score)
        ? Math.max(0, Math.min(1, settings.min_score))
        : 0.5;
    console.log("min_score:", settings.min_score, "→ using:", minScore);
    console.log("search_model:", settings.search_model);
  } catch (e: any) {
    console.error("Settings error:", e.message);
  }

  section("STEP 3 — Redis cache lookup");
  const cacheKey = getSearchCacheKey(
    userId,
    QUERY,
    collectionNames,
    TOP_K,
    "video",
    EXPAND_QUERY,
    minScore
  );
  console.log("Cache key:", cacheKey);

  const embeddingCacheKey = `embedding:${crypto.createHash("md5").update(QUERY.toLowerCase().trim()).digest("hex")}`;
  console.log("Embedding cache key (post-expansion uses expanded text):", embeddingCacheKey);

  const redis = new Redis({
    host: CONFIG.redis.host,
    port: CONFIG.redis.port,
    username: CONFIG.redis.username,
    password: CONFIG.redis.password,
    db: CONFIG.redis.db,
    lazyConnect: true,
    connectTimeout: 5000,
  });
  await redis.connect();

  const cachedSearch = await redis.get(cacheKey);
  console.log("Search cache HIT:", cachedSearch ? "YES" : "NO");
  if (cachedSearch) {
    const parsed = JSON.parse(cachedSearch);
    console.log("Cached result keys:", Object.keys(parsed.results || {}).length, "videos");
    console.log("Cached expandedQuery:", (parsed.expandedQuery || "").slice(0, 200));
    console.log("Cached TTL remaining:", await redis.ttl(cacheKey), "seconds");
  }

  const cachedEmbedding = await redis.get(embeddingCacheKey);
  console.log("Embedding cache HIT (for raw query hash):", cachedEmbedding ? "YES" : "NO");

  // List all search keys for this user
  const searchKeys: string[] = [];
  const stream = redis.scanStream({ match: `search:video:${userId}:*`, count: 100 });
  stream.on("data", (keys: string[]) => searchKeys.push(...keys));
  await new Promise<void>((resolve) => stream.on("end", resolve));
  console.log(`All video search cache keys for user (${searchKeys.length}):`);
  searchKeys.slice(0, 10).forEach((k) => console.log("  ", k));
  if (searchKeys.length > 10) console.log(`  ... and ${searchKeys.length - 10} more`);

  section("STEP 4 — Query expansion (OpenAI chat)");
  let expandedQuery = QUERY;
  try {
    expandedQuery = await resourceService.expandQuery(
      `Expand the following search query:\n\n${QUERY}`,
      userId,
      "/debug-search"
    );
    console.log("Expanded query:", expandedQuery.slice(0, 500));
  } catch (e: any) {
    console.error("Query expansion FAILED:", e.message);
    console.log("Falling back to original query");
  }

  const expandedEmbeddingKey = `embedding:${crypto.createHash("md5").update(expandedQuery.toLowerCase().trim()).digest("hex")}`;
  console.log("Embedding cache key (expanded):", expandedEmbeddingKey);
  const cachedExpandedEmb = await redis.get(expandedEmbeddingKey);
  console.log("Embedding cache HIT (expanded):", cachedExpandedEmb ? "YES" : "NO");

  section("STEP 5 — OpenAI embedding");
  const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });
  let embedding: number[] | null = null;
  try {
    const start = Date.now();
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: expandedQuery,
    });
    embedding = resp.data[0].embedding;
    console.log("Embedding OK — dims:", embedding.length, "time:", Date.now() - start, "ms");
    console.log("First 5 values:", embedding.slice(0, 5).map((v) => v.toFixed(6)));
  } catch (e: any) {
    console.error("Embedding FAILED:", e.message);
    if (e.status) console.error("HTTP status:", e.status);
  }

  section("STEP 6 — Pinecone raw query (per collection)");
  const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
  const index = pc.index(CONFIG.pinecone.index);

  for (const collectionName of collectionNames) {
    const namespace = createCollectionNamespace(userId, collectionName, "video");
    console.log(`\n--- Collection: "${collectionName}" → namespace: "${namespace}" ---`);

    const nsStats = (await index.describeIndexStats()).namespaces?.[namespace];
    console.log("Vectors in namespace:", nsStats?.recordCount ?? 0);

    if (!embedding) {
      console.log("Skipping Pinecone query (no embedding)");
      continue;
    }

    try {
      const fetchTopK = Math.max(TOP_K * 5, 20) * 3;
      const raw = await index.namespace(namespace).query({
        vector: embedding,
        topK: fetchTopK,
        includeMetadata: true,
      });

      console.log(`Raw Pinecone matches: ${raw.matches.length}`);
      raw.matches.slice(0, 8).forEach((m, i) => {
        const text = ((m.metadata?.text as string) || "").slice(0, 90);
        const videoUrl = ((m.metadata?.videoUrl as string) || "").slice(0, 60);
        console.log(
          `  ${i + 1}. score=${(m.score || 0).toFixed(4)} minScore=${minScore} ${(m.score || 0) >= minScore ? "PASS" : "FILTERED"}`
        );
        console.log(`     video: ${videoUrl}`);
        console.log(`     text:  ${text}`);
      });

      const afterFilter = raw.matches.filter((m) => (m.score || 0) >= minScore);
      console.log(`After minScore filter: ${afterFilter.length} matches`);
    } catch (e: any) {
      console.error("Pinecone query FAILED:", e.message);
    }
  }

  section("STEP 7 — Full service layer (VideoProcessingService)");
  try {
    const grouped = await videoService.searchVideosMultipleCollections(
      expandedQuery,
      userId,
      collectionNames,
      TOP_K,
      minScore
    );
    const videoUrls = Object.keys(grouped);
    console.log("Grouped videos returned:", videoUrls.length);
    for (const [url, data] of Object.entries(grouped).slice(0, 5)) {
      console.log(`\n  Video: ${url.slice(0, 70)}...`);
      console.log(`  bestScore: ${data.bestScore.toFixed(4)}, clips: ${data.clips.length}`);
      data.clips.slice(0, 3).forEach((c, i) => {
        console.log(`    clip ${i + 1}: ${c.startTime}-${c.endTime} score=${c.score.toFixed(4)}`);
      });
    }
  } catch (e: any) {
    console.error("VideoProcessingService FAILED:", e.message);
  }

  section("SUMMARY");
  if (!embedding) {
    console.log("BLOCKER: OpenAI embedding failed — search cannot proceed.");
    console.log("Fix OPENAI_API_KEY in .env / deployment.");
  } else if (cachedSearch) {
    console.log("NOTE: A cached result exists for this query. API would return cache without re-querying Pinecone.");
    console.log("To force fresh search: DEL", cacheKey);
  }

  await redis.quit();
}

main().catch((e) => {
  console.error("Debug script failed:", e);
  process.exit(1);
});
