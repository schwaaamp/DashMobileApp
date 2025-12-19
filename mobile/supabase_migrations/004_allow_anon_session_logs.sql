-- Allow anonymous (unauthenticated) sessions to write logs before user authentication
-- This fixes the RLS error that occurs when the app first starts

-- Add policy for anon users to insert session logs with null user_id
-- This allows logging to work before user authentication
CREATE POLICY "Allow anon session logs"
  ON app_logs
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- Note: The existing "Users can insert their own logs" policy (from migration 003)
-- handles authenticated users inserting logs with their own user_id or null user_id
-- This new policy complements it by handling the pre-authentication case
