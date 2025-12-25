-- Collection metadata table: tracks collection existence
-- This allows empty collections to exist before any resources are added
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS collection_metadata (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  collection_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one collection name per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_metadata_unique 
ON collection_metadata(user_id, collection_name);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_collection_metadata_user_id 
ON collection_metadata(user_id);

-- Enable Row Level Security
ALTER TABLE collection_metadata ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to manage their own collection metadata
CREATE POLICY "Users can manage their own collection metadata"
  ON collection_metadata
  FOR ALL
  USING (auth.uid() = user_id);

-- Insert 'Default' collection for existing users who have resources
-- This ensures the Default collection shows up even if it wasn't explicitly created
INSERT INTO collection_metadata (user_id, collection_name)
SELECT DISTINCT user_id, 'Default'
FROM collections
WHERE collection_name = 'Default'
ON CONFLICT (user_id, collection_name) DO NOTHING;

