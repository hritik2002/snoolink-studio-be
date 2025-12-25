-- Collections table: stores all resources (images/videos)
-- Collections are logical groupings by collection_name, not separate rows
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS collections (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  
  -- Collection grouping (resources with same collection_name belong to same collection)
  collection_name TEXT NOT NULL DEFAULT 'Default',
  
  -- Resource data
  resource_url TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('image', 'video')),
  description TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_user_collection ON collections(user_id, collection_name);
CREATE INDEX IF NOT EXISTS idx_collections_resource_type ON collections(resource_type);

-- Prevent duplicate resource URLs in same collection for same user
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_unique_resource 
ON collections(user_id, collection_name, resource_url);

-- Enable Row Level Security
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to manage their own resources
CREATE POLICY "Users can manage their own resources"
  ON collections
  FOR ALL
  USING (auth.uid() = user_id);
