-- Cost Tracking Table for OpenAI API Usage
-- This table tracks all GPT/OpenAI API calls with comprehensive cost and usage data

CREATE TABLE IF NOT EXISTS openai_cost_tracking (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  
  -- API Call Details
  api_type TEXT NOT NULL, -- 'chat_completion', 'embedding', 'vision'
  model TEXT NOT NULL, -- 'gpt-4o-mini', 'text-embedding-ada-002', etc.
  operation_type TEXT NOT NULL, -- 'image_description', 'query_expansion', 'video_frame_description', 'video_summary', 'embedding', etc.
  
  -- Token Usage
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  
  -- Cost Information
  cost_usd DECIMAL(12, 8) NOT NULL DEFAULT 0, -- Cost in USD with high precision
  cost_breakdown JSONB, -- Detailed cost breakdown (input_cost, output_cost, image_cost, etc.)
  
  -- Context and Metadata
  endpoint TEXT, -- API endpoint or route where this was called
  context TEXT, -- Additional context about the operation
  metadata JSONB, -- Flexible JSON for additional metadata (collection_name, resource_type, etc.)
  
  -- Request/Response Info
  request_id TEXT, -- OpenAI request ID if available
  response_time_ms INTEGER, -- Time taken for the API call in milliseconds
  
  -- Status
  success BOOLEAN DEFAULT true,
  error_message TEXT, -- Error message if the call failed
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes for efficient querying
  CONSTRAINT valid_api_type CHECK (api_type IN ('chat_completion', 'embedding', 'vision')),
  CONSTRAINT valid_tokens CHECK (total_tokens >= 0 AND prompt_tokens >= 0 AND completion_tokens >= 0),
  CONSTRAINT valid_cost CHECK (cost_usd >= 0)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cost_tracking_user_id ON openai_cost_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_created_at ON openai_cost_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_operation_type ON openai_cost_tracking(operation_type);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_model ON openai_cost_tracking(model);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_api_type ON openai_cost_tracking(api_type);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_user_date ON openai_cost_tracking(user_id, created_at);

-- Composite index for common queries (user + date range + operation)
CREATE INDEX IF NOT EXISTS idx_cost_tracking_user_operation_date ON openai_cost_tracking(user_id, operation_type, created_at);

-- Enable Row Level Security
ALTER TABLE openai_cost_tracking ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own cost tracking data
CREATE POLICY "Users can view their own cost tracking"
  ON openai_cost_tracking
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Service role can insert/update cost tracking (for backend operations)
CREATE POLICY "Service role can manage cost tracking"
  ON openai_cost_tracking
  FOR ALL
  USING (auth.role() = 'service_role');

-- Comments for documentation
COMMENT ON TABLE openai_cost_tracking IS 'Tracks all OpenAI API usage and costs for business intelligence and billing';
COMMENT ON COLUMN openai_cost_tracking.api_type IS 'Type of OpenAI API: chat_completion, embedding, or vision';
COMMENT ON COLUMN openai_cost_tracking.operation_type IS 'Business operation type: image_description, query_expansion, video_frame_description, video_summary, embedding';
COMMENT ON COLUMN openai_cost_tracking.cost_breakdown IS 'JSON object with detailed cost breakdown (input_cost, output_cost, image_cost, etc.)';
COMMENT ON COLUMN openai_cost_tracking.metadata IS 'Flexible JSON for additional context (collection_name, resource_type, video_url, etc.)';

