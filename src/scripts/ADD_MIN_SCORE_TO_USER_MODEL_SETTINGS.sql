-- Add min_score to user_model_settings for search result filtering.
-- Run in Supabase SQL editor. Existing rows will have min_score = NULL (backend uses 0.5 as default).
-- Valid range: 0.0–1.0 (cosine similarity). Backend clamps and defaults to 0.5 when null.
ALTER TABLE user_model_settings ADD COLUMN IF NOT EXISTS min_score REAL;
