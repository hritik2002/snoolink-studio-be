# Pinecone Namespace Migration Guide

## Overview

This guide explains how to migrate your existing Pinecone data from the old namespace format to the new collection-based namespace format.

## What's Changing?

### Old Namespace Format
- Images: `user-{userId}-images`
- Videos: `user-{userId}-videos`

### New Namespace Format
- Images: `{userId}-image-{collectionName}`
- Videos: `{userId}-video-{collectionName}`

For existing data, everything will be migrated to the "Default" collection:
- Images: `{userId}-image-default`
- Videos: `{userId}-video-default`

## Migration Steps

### 1. Test the Migration (Dry Run)

First, run the migration in dry-run mode to see what would happen without making any changes:

```bash
cd snoolink-studio-backend
npm run migrate:namespaces:dry
```

This will:
- Show you how many users will be processed
- Display how many vectors would be migrated for each user
- Report any potential errors
- **NOT make any actual changes**

### 2. Run the Actual Migration

Once you're confident with the dry run results, perform the actual migration:

```bash
npm run migrate:namespaces
```

This will:
- Fetch all user IDs from Supabase
- For each user:
  - Copy all image vectors from `user-{userId}-images` to `{userId}-image-default`
  - Copy all video vectors from `user-{userId}-videos` to `{userId}-video-default`
- Display a summary of migrated vectors

### 3. Verify the Migration

After migration, test your search functionality:
1. Go to the Search page
2. Select "All" or "Default" collection
3. Search for content you know exists
4. Verify results are returned correctly

## What Happens to Old Data?

The migration script **copies** data from old namespaces to new namespaces. It does **NOT** delete the old namespaces.

After verifying the migration was successful, you can manually delete the old namespaces from the Pinecone console if desired.

## Troubleshooting

### No vectors found in old namespace
- This is normal if a user hasn't uploaded any content yet
- The script will skip that user and continue

### Migration fails for specific user
- The error will be logged but migration continues for other users
- Check the error message for details
- You can re-run the migration script - it will overwrite existing vectors

### Search still returns 0 results
1. Verify the migration completed successfully
2. Check that you selected the correct collection (Default or All)
3. Check the Pinecone console to verify namespaces were created
4. Check backend logs for any errors during search

## Migration Statistics

The script provides detailed statistics including:
- Number of users processed
- Total images migrated
- Total videos migrated
- Any errors encountered

## Example Output

```
🚀 Starting Pinecone Namespace Migration
=====================================

📋 Fetching all user IDs from Supabase...
✅ Found 3 unique users

[1/3] ================================

👤 Processing user: abc-123-def-456
  📦 Migrating images from "user-abc-123-def-456-images" to "abc-123-def-456-image-default"
    📊 Found 50 vectors to migrate
    ✅ Successfully migrated 50 images

  📦 Migrating videos from "user-abc-123-def-456-videos" to "abc-123-def-456-video-default"
    📊 Found 20 vectors to migrate
    ✅ Successfully migrated 20 videos

...

📊 Migration Summary
===================
Users processed: 3
Images migrated: 150
Videos migrated: 60
Total vectors migrated: 210

✅ Migration completed successfully!
```

## Need Help?

If you encounter any issues during migration, check:
1. Pinecone API key is correct in `.env`
2. Supabase credentials are correct
3. You have sufficient Pinecone quota
4. Network connectivity to Pinecone and Supabase

