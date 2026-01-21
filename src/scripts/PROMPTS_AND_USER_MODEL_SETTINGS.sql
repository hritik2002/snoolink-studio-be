-- Prompts and user model settings
--
-- Run this in the Supabase SQL editor to create the tables.
-- Backend: set ADMIN_EMAILS (comma-separated) in env, e.g. ADMIN_EMAILS=admin@example.com,other@example.com
--
-- Prompts: model (unique), prompt text, creator email. Admin-only insert via API (ADMIN_EMAILS env).
-- RLS: authenticated can read; insert/update/delete enforced in backend by admin check.
CREATE TABLE IF NOT EXISTS prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  creator TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompts_model ON prompts(model);

-- Allow read for authenticated users (for Settings dropdown and backend resolution)
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read prompts" ON prompts;
CREATE POLICY "Authenticated users can read prompts" ON prompts
  FOR SELECT TO authenticated USING (true);

-- Insert/Update/Delete are done via backend with admin check; no DB policy (backend uses service role)

-- User model settings: which prompt model to use for search and ingestion per user
-- min_score: minimum similarity threshold (0–1) for vector search; NULL = use 0.5
CREATE TABLE IF NOT EXISTS user_model_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  search_model TEXT,
  ingestion_model TEXT,
  min_score REAL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_model_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own model settings" ON user_model_settings;
CREATE POLICY "Users can read own model settings" ON user_model_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own model settings" ON user_model_settings;
CREATE POLICY "Users can insert own model settings" ON user_model_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own model settings" ON user_model_settings;
CREATE POLICY "Users can update own model settings" ON user_model_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
