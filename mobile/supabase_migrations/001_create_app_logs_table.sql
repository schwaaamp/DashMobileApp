-- Create app_logs table for structured application logging
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS app_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  session_id TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  app_version TEXT,
  platform TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
CREATE INDEX IF NOT EXISTS idx_app_logs_category ON app_logs(category);
CREATE INDEX IF NOT EXISTS idx_app_logs_session_id ON app_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_user_id ON app_logs(user_id);

-- Create index on metadata for JSON queries
CREATE INDEX IF NOT EXISTS idx_app_logs_metadata ON app_logs USING GIN (metadata);

-- Enable Row Level Security
ALTER TABLE app_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow insert for authenticated users (they can log their own events)
CREATE POLICY "Users can insert their own logs"
  ON app_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Allow read for authenticated users (they can read their own logs)
CREATE POLICY "Users can read their own logs"
  ON app_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Admins can read all logs (you'll need to set up an admin role)
-- Uncomment and modify if you have an admin role set up:
-- CREATE POLICY "Admins can read all logs"
--   ON app_logs
--   FOR SELECT
--   TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM user_roles
--       WHERE user_id = auth.uid() AND role = 'admin'
--     )
--   );

-- Create a view for recent errors (useful for debugging)
CREATE OR REPLACE VIEW recent_errors AS
SELECT
  id,
  created_at,
  timestamp,
  category,
  message,
  session_id,
  user_id,
  platform,
  metadata
FROM app_logs
WHERE level = 'error'
ORDER BY created_at DESC
LIMIT 100;

-- Create a view for parsing errors specifically
CREATE OR REPLACE VIEW parsing_errors AS
SELECT
  id,
  created_at,
  timestamp,
  message,
  session_id,
  user_id,
  platform,
  metadata->>'input_preview' as input_preview,
  metadata->>'error' as error_message,
  metadata->>'raw_text_preview' as raw_text_preview
FROM app_logs
WHERE category = 'parsing' AND level = 'error'
ORDER BY created_at DESC
LIMIT 100;

-- Create a view for API call logs
CREATE OR REPLACE VIEW api_call_logs AS
SELECT
  id,
  created_at,
  timestamp,
  message,
  session_id,
  user_id,
  platform,
  metadata->>'endpoint' as endpoint,
  metadata->>'duration_ms' as duration_ms,
  metadata->>'response_status' as response_status,
  metadata->>'success' as success
FROM app_logs
WHERE category = 'api'
ORDER BY created_at DESC
LIMIT 100;

-- Grant permissions to authenticated users to use views
GRANT SELECT ON recent_errors TO authenticated;
GRANT SELECT ON parsing_errors TO authenticated;
GRANT SELECT ON api_call_logs TO authenticated;

COMMENT ON TABLE app_logs IS 'Structured application logs for debugging and monitoring';
COMMENT ON COLUMN app_logs.level IS 'Log level: debug, info, warn, error';
COMMENT ON COLUMN app_logs.category IS 'Log category: api, parsing, user_action, json_extraction, session, etc.';
COMMENT ON COLUMN app_logs.metadata IS 'Additional context as JSON (sanitized to remove PII)';
