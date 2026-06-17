-- Extend collection_metadata with type, description, and settings
-- Run in Supabase SQL Editor (Dashboard → SQL → New query)
-- Or: npm run migrate:collection-metadata (requires SUPABASE_DB_PASSWORD in .env)

ALTER TABLE collection_metadata
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS collection_type TEXT NOT NULL DEFAULT 'media_descriptions',
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS segmentation_config JSONB;

COMMENT ON COLUMN collection_metadata.collection_type IS 'media_descriptions | entities | face_analysis';
COMMENT ON COLUMN collection_metadata.settings IS 'Type-specific processing settings';
COMMENT ON COLUMN collection_metadata.segmentation_config IS 'Optional video segmentation overrides';
