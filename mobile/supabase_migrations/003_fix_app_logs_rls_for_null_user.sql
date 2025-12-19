-- Fix RLS policies for app_logs to allow logs with null user_id
-- This is needed for session logs and logs written before user authentication

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can insert their own logs" ON app_logs;

-- Create a more permissive INSERT policy
-- Allow authenticated users to insert:
-- 1. Logs with their own user_id
-- 2. Logs with null user_id (for session logs, etc.)
CREATE POLICY "Users can insert their own logs"
  ON app_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id IS NULL OR auth.uid() = user_id
  );

-- Also update the SELECT policy to allow reading logs with null user_id
DROP POLICY IF EXISTS "Users can read their own logs" ON app_logs;

CREATE POLICY "Users can read their own logs"
  ON app_logs
  FOR SELECT
  TO authenticated
  USING (
    user_id IS NULL OR auth.uid() = user_id
  );

-- Optional: Add a policy to allow anon users to insert logs with null user_id
-- This is useful if you want to log errors before authentication
-- Uncomment if needed:
-- CREATE POLICY "Allow anon session logs"
--   ON app_logs
--   FOR INSERT
--   TO anon
--   WITH CHECK (user_id IS NULL);
