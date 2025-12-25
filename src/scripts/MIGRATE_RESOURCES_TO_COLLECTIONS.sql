-- Migration script: Migrate data from resource_table to collections table
-- Run this AFTER running COLLECTIONS_TABLE_SETUP.sql

-- Step 1: Migrate all resources from resource_table to collections table
-- All resources go to "Default" collection
INSERT INTO collections (user_id, collection_name, resource_url, resource_type, description, created_at)
SELECT 
  r.user_id::UUID,
  'Default' as collection_name,
  r.resource_url,
  r.resource_type,
  r.description,
  r.created_at
FROM resource_table r
WHERE r.resource_type IS NOT NULL
ON CONFLICT (user_id, collection_name, resource_url) DO NOTHING;

-- Step 2: Verify migration
SELECT 
  'Images migrated' as status,
  COUNT(*) as count
FROM collections
WHERE resource_type = 'image'
UNION ALL
SELECT 
  'Videos migrated' as status,
  COUNT(*) as count
FROM collections
WHERE resource_type = 'video'
UNION ALL
SELECT 
  'Original resources in resource_table' as status,
  COUNT(*) as count
FROM resource_table;

-- Step 3: Show collections summary
SELECT 
  user_id,
  collection_name,
  COUNT(*) FILTER (WHERE resource_type = 'image') as image_count,
  COUNT(*) FILTER (WHERE resource_type = 'video') as video_count,
  COUNT(*) as total_resources
FROM collections
GROUP BY user_id, collection_name
ORDER BY user_id, collection_name;

-- Step 4: After verifying the migration, DROP the old table
-- IMPORTANT: Only run this after you have verified the migration is complete!
-- DROP TABLE IF EXISTS resource_table;
