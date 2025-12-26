/**
 * Migration Script: Migrate Pinecone Data to Collection-Based Namespaces
 * 
 * This script migrates data from old namespace format to new collection-based format:
 * 
 * OLD FORMAT:
 *   - Images: user-{userId}-images
 *   - Videos: user-{userId}-videos
 * 
 * NEW FORMAT:
 *   - Images: {userId}-image-default
 *   - Videos: {userId}-video-default
 * 
 * Usage:
 *   DRY_RUN=true npm run migrate:namespaces  # Test run (no changes)
 *   npm run migrate:namespaces               # Actual migration
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { SupabaseService } from "../services/supabaseService";
import { CONFIG } from "../config";
import { createUserNamespace, createCollectionNamespace } from "../utils/namespace";

const DRY_RUN = process.env.DRY_RUN === "true";
const BATCH_SIZE = 100; // Number of vectors to migrate at once

interface MigrationStats {
  usersProcessed: number;
  imagesMigrated: number;
  videosMigrated: number;
  errors: string[];
}

const stats: MigrationStats = {
  usersProcessed: 0,
  imagesMigrated: 0,
  videosMigrated: 0,
  errors: [],
};

async function getAllUserIds(): Promise<string[]> {
  console.log("📋 Fetching all user IDs from Supabase...");
  const supabaseService = new SupabaseService();
  
  // Get distinct user IDs from collections table
  const { data, error } = await (supabaseService as any).supabaseClient
    .from("collections")
    .select("user_id")
    .order("user_id");

  if (error) {
    throw new Error(`Failed to fetch users: ${error.message}`);
  }

  // Get unique user IDs
  const uniqueUserIds: string[] = Array.from(new Set(data.map((row: any) => row.user_id as string)));
  console.log(`✅ Found ${uniqueUserIds.length} unique users\n`);
  
  return uniqueUserIds;
}

async function migrateNamespace(
  pinecone: Pinecone,
  indexName: string,
  oldNamespace: string,
  newNamespace: string,
  resourceType: "image" | "video"
): Promise<number> {
  console.log(`  📦 Migrating ${resourceType}s from "${oldNamespace}" to "${newNamespace}"`);

  try {
    const index = pinecone.index(indexName);
    
    // Get all vector IDs from old namespace
    const oldNamespaceIndex = index.namespace(oldNamespace);
    
    // Query to get all vectors (using empty vector to get all results)
    const listResponse = await oldNamespaceIndex.listPaginated();
    
    if (!listResponse.vectors || listResponse.vectors.length === 0) {
      console.log(`    ℹ️  No vectors found in old namespace\n`);
      return 0;
    }

    console.log(`    📊 Found ${listResponse.vectors.length} vectors to migrate`);

    let migratedCount = 0;
    let cursor = listResponse.pagination?.next;

    // Process first batch
    const firstBatchIds = listResponse.vectors.map(v => v.id).filter((id): id is string => id !== undefined);
    await migrateBatch(index, oldNamespace, newNamespace, firstBatchIds);
    migratedCount += listResponse.vectors.length;

    // Process remaining batches if there are more
    while (cursor) {
      const nextBatch = await oldNamespaceIndex.listPaginated({ paginationToken: cursor });
      if (nextBatch.vectors && nextBatch.vectors.length > 0) {
        const batchIds = nextBatch.vectors.map(v => v.id).filter((id): id is string => id !== undefined);
        await migrateBatch(index, oldNamespace, newNamespace, batchIds);
        migratedCount += nextBatch.vectors.length;
        console.log(`    ✓ Migrated ${migratedCount} vectors so far...`);
      }
      cursor = nextBatch.pagination?.next;
    }

    console.log(`    ✅ Successfully migrated ${migratedCount} ${resourceType}s\n`);
    return migratedCount;
  } catch (error: any) {
    const errorMsg = `Failed to migrate ${resourceType}s from ${oldNamespace}: ${error.message}`;
    console.error(`    ❌ ${errorMsg}\n`);
    stats.errors.push(errorMsg);
    return 0;
  }
}

async function migrateBatch(
  index: any,
  oldNamespace: string,
  newNamespace: string,
  vectorIds: string[]
): Promise<void> {
  if (vectorIds.length === 0) return;

  // Fetch vectors from old namespace
  const oldNamespaceIndex = index.namespace(oldNamespace);
  const fetchResponse = await oldNamespaceIndex.fetch(vectorIds);

  if (!fetchResponse.records || Object.keys(fetchResponse.records).length === 0) {
    return;
  }

  // Prepare vectors for new namespace
  const vectorsToUpsert = Object.entries(fetchResponse.records).map(([id, record]: [string, any]) => ({
    id,
    values: record.values,
    metadata: record.metadata,
  }));

  if (DRY_RUN) {
    console.log(`    [DRY RUN] Would migrate ${vectorsToUpsert.length} vectors`);
    return;
  }

  // Upsert to new namespace
  const newNamespaceIndex = index.namespace(newNamespace);
  await newNamespaceIndex.upsert(vectorsToUpsert);
}

async function migrateUserData(pinecone: Pinecone, userId: string): Promise<void> {
  console.log(`\n👤 Processing user: ${userId}`);
  
  const indexName = CONFIG.pinecone.index;

  // Migrate images: user-{userId}-images -> {userId}-image-default
  const oldImageNamespace = createUserNamespace(userId, "image");
  const newImageNamespace = createCollectionNamespace(userId, "Default", "image");
  const imageCount = await migrateNamespace(
    pinecone,
    indexName,
    oldImageNamespace,
    newImageNamespace,
    "image"
  );
  stats.imagesMigrated += imageCount;

  // Migrate videos: user-{userId}-videos -> {userId}-video-default
  const oldVideoNamespace = createUserNamespace(userId, "video");
  const newVideoNamespace = createCollectionNamespace(userId, "Default", "video");
  const videoCount = await migrateNamespace(
    pinecone,
    indexName,
    oldVideoNamespace,
    newVideoNamespace,
    "video"
  );
  stats.videosMigrated += videoCount;

  stats.usersProcessed++;
}

async function main() {
  console.log("🚀 Starting Pinecone Namespace Migration");
  console.log("=====================================\n");
  
  if (DRY_RUN) {
    console.log("⚠️  DRY RUN MODE - No changes will be made\n");
  }

  try {
    // Initialize Pinecone
    const pinecone = new Pinecone({
      apiKey: CONFIG.pinecone.apiKey,
    });

    // Get all users
    const userIds = await getAllUserIds();

    if (userIds.length === 0) {
      console.log("ℹ️  No users found to migrate");
      return;
    }

    // Migrate each user's data
    for (let i = 0; i < userIds.length; i++) {
      console.log(`\n[${i + 1}/${userIds.length}] ================================`);
      await migrateUserData(pinecone, userIds[i]);
    }

    // Print summary
    console.log("\n\n📊 Migration Summary");
    console.log("===================");
    console.log(`Users processed: ${stats.usersProcessed}`);
    console.log(`Images migrated: ${stats.imagesMigrated}`);
    console.log(`Videos migrated: ${stats.videosMigrated}`);
    console.log(`Total vectors migrated: ${stats.imagesMigrated + stats.videosMigrated}`);
    
    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
      stats.errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`);
      });
    } else {
      console.log("\n✅ Migration completed successfully!");
    }

    if (DRY_RUN) {
      console.log("\n⚠️  This was a DRY RUN. Run without DRY_RUN=true to perform actual migration.");
    }

  } catch (error: any) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
}

// Run migration
main()
  .then(() => {
    console.log("\n✨ Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Fatal error:", error);
    process.exit(1);
  });

