-- User analytics events: user-scoped product analytics for value and monetization insights.
-- Run in Supabase SQL editor. RLS ensures users only read their own data; backend uses service role to insert.

CREATE TABLE IF NOT EXISTS user_analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'server' CHECK (source IN ('client', 'server')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_analytics_user_created ON user_analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_analytics_user_name_created ON user_analytics_events(user_id, event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_analytics_created ON user_analytics_events(created_at DESC);

ALTER TABLE user_analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own analytics" ON user_analytics_events;
CREATE POLICY "Users can read own analytics" ON user_analytics_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Insert: only via backend service role (RLS bypass). No INSERT policy for authenticated/anon.

COMMENT ON TABLE user_analytics_events IS 'User-scoped product analytics: searches, uploads, collections, page views. For user value and monetization.';
