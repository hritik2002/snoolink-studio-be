/**
 * Nuclear reset: wipes app data across Supabase, Pinecone, Redis, S3, and Cloudinary.
 * Keeps: auth users, profiles, prompts (admin templates).
 *
 * Usage:
 *   RESET_CONFIRM=yes npm run reset:all
 *   RESET_CONFIRM=yes npm run reset:all -- --dry-run
 */
import dotenv from "dotenv";
dotenv.config();

import { Pinecone } from "@pinecone-database/pinecone";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { v2 as cloudinary } from "cloudinary";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIRMED = process.env.RESET_CONFIRM === "yes";

const SUPABASE_TABLES = [
  "collections",
  "collection_metadata",
  "api_logs",
  "openai_cost_tracking",
  "user_analytics_events",
  "user_model_settings",
] as const;

function section(title: string) {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

async function wipeSupabase() {
  section("SUPABASE");
  const client = createClient(CONFIG.supabase.supabaseUrl, CONFIG.supabase.supabaseKey);

  for (const table of SUPABASE_TABLES) {
    if (DRY_RUN) {
      const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
      if (error) console.log(`  [DRY RUN] ${table}: would delete ~${count ?? "?"} rows (error: ${error.message})`);
      else console.log(`  [DRY RUN] ${table}: would delete ${count ?? 0} rows`);
      continue;
    }

    const { error, count } = await client.from(table).delete({ count: "exact" }).neq("id", 0);
    if (error) {
      // Tables with UUID primary key (no bigint id)
      const { error: err2, count: count2 } = await client
        .from(table)
        .delete({ count: "exact" })
        .neq("user_id", "00000000-0000-0000-0000-000000000000");
      if (err2) {
        console.error(`  ✗ ${table}: ${err2.message}`);
      } else {
        console.log(`  ✓ ${table}: deleted ${count2 ?? "?"} rows`);
      }
    } else {
      console.log(`  ✓ ${table}: deleted ${count ?? "?"} rows`);
    }
  }
}

async function wipePinecone() {
  section("PINECONE");
  const indexName = CONFIG.pinecone.index;
  console.log(`Index: ${indexName}`);

  const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
  const index = pc.index(indexName);
  const stats = await index.describeIndexStats();
  const namespaces = Object.keys(stats.namespaces || {});

  console.log(`Total vectors: ${stats.totalRecordCount}, namespaces: ${namespaces.length}`);

  if (namespaces.length === 0) {
    console.log("  Nothing to delete.");
    return;
  }

  for (const ns of namespaces) {
    const count = stats.namespaces?.[ns]?.recordCount ?? 0;
    if (DRY_RUN) {
      console.log(`  [DRY RUN] would deleteAll namespace "${ns}" (${count} vectors)`);
      continue;
    }
    await index.namespace(ns).deleteAll();
    console.log(`  ✓ deleted namespace "${ns}" (${count} vectors)`);
  }
}

async function wipeRedis() {
  section("REDIS");
  const redis = new Redis({
    host: CONFIG.redis.host,
    port: CONFIG.redis.port,
    username: CONFIG.redis.username,
    password: CONFIG.redis.password,
    db: CONFIG.redis.db,
    lazyConnect: true,
  });
  await redis.connect();

  const dbSize = await redis.dbsize();
  console.log(`Keys in db ${CONFIG.redis.db}: ${dbSize}`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] would FLUSHDB`);
  } else {
    await redis.flushdb();
    console.log(`  ✓ FLUSHDB complete (cache + BullMQ queues cleared)`);
  }

  await redis.quit();
}

async function wipeS3() {
  section("S3");
  const prefix = "snoolink-studio/";
  console.log(`Bucket: ${CONFIG.s3.bucketName}, prefix: ${prefix}`);

  const s3 = new S3Client({
    region: CONFIG.s3.region,
    credentials: {
      accessKeyId: CONFIG.s3.accessKeyId,
      secretAccessKey: CONFIG.s3.secretAccessKey,
    },
  });

  let continuationToken: string | undefined;
  let totalDeleted = 0;

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: CONFIG.s3.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (list.Contents || []).map((o) => o.Key).filter(Boolean) as string[];
    if (keys.length === 0) break;

    if (DRY_RUN) {
      totalDeleted += keys.length;
      console.log(`  [DRY RUN] would delete ${keys.length} objects (batch)`);
    } else {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: CONFIG.s3.bucketName,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        })
      );
      totalDeleted += keys.length;
      console.log(`  ✓ deleted ${keys.length} objects`);
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`  Total S3 objects ${DRY_RUN ? "to delete" : "deleted"}: ${totalDeleted}`);
}

async function wipeCloudinary() {
  section("CLOUDINARY");
  cloudinary.config({ ...CONFIG.cloudinary });

  for (const resourceType of ["image", "video"] as const) {
    if (DRY_RUN) {
      console.log(`  [DRY RUN] would delete all Cloudinary ${resourceType} uploads`);
      continue;
    }
    try {
      const result = await cloudinary.api.delete_all_resources({
        resource_type: resourceType,
        type: "upload",
        keep_original: false,
      });
      console.log(`  ✓ Cloudinary ${resourceType}:`, JSON.stringify(result.deleted || result));
    } catch (e: any) {
      console.error(`  ✗ Cloudinary ${resourceType}:`, e.message || e);
    }
  }
}

async function main() {
  console.log(DRY_RUN ? "\n🔍 DRY RUN — no data will be deleted\n" : "\n⚠️  LIVE RESET — deleting all app data\n");

  if (!DRY_RUN && !CONFIRMED) {
    console.error("Aborted. Set RESET_CONFIRM=yes to run a live reset.");
    console.error("  RESET_CONFIRM=yes npm run reset:all");
    console.error("  RESET_CONFIRM=yes npm run reset:all -- --dry-run  # preview only");
    process.exit(1);
  }

  console.log("Keeps: auth users, profiles, prompts");
  console.log("Wipes: collections, vectors, cache, queues, S3 uploads, Cloudinary uploads, logs, analytics, cost tracking");

  await wipeSupabase();
  await wipePinecone();
  await wipeRedis();

  try {
    await wipeS3();
  } catch (e: any) {
    console.error("  S3 wipe skipped:", e.message || e);
  }

  try {
    await wipeCloudinary();
  } catch (e: any) {
    console.error("  Cloudinary wipe skipped:", e.message || e);
  }

  section("DONE");
  if (DRY_RUN) {
    console.log("Dry run complete. Run with RESET_CONFIRM=yes to execute.");
  } else {
    console.log("Fresh start ready. Update OPENAI_API_KEY if needed, then re-upload content.");
  }
}

main().catch((e) => {
  console.error("Reset failed:", e);
  process.exit(1);
});
