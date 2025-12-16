-- Create api_logs table for storing API request/response logs
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS api_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_query TEXT NOT NULL,
  enhanced_query TEXT,
  response JSONB,
  error TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON api_logs(user_id);

-- Create index on created_at for faster date range queries
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at DESC);

-- Create index on endpoint for filtering by endpoint
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_logs(endpoint);

-- Optional: Enable Row Level Security (RLS) if you want users to only see their own logs
-- ALTER TABLE api_logs ENABLE ROW LEVEL SECURITY;

-- Optional: Create policy to allow users to see only their own logs
-- CREATE POLICY "Users can view their own logs"
--   ON api_logs
--   FOR SELECT
--   USING (auth.uid() = user_id);

