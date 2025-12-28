-- Add video metadata columns to collections table
-- This migration adds duration and resolution columns for video resources
-- Run this SQL in your Supabase SQL Editor

-- Add duration column (in seconds, stored as DECIMAL for precision)
ALTER TABLE collections 
ADD COLUMN IF NOT EXISTS duration DECIMAL(10, 2);

-- Add resolution column (format: "1920x1080" or "widthxheight")
ALTER TABLE collections
ADD COLUMN IF NOT EXISTS resolution TEXT;

-- Add comments for documentation
COMMENT ON COLUMN collections.duration IS 'Video duration in seconds (only for video resources)';
COMMENT ON COLUMN collections.resolution IS 'Video resolution in format "widthxheight" (e.g., "1920x1080") (only for video resources)';

