-- Fix voice_records_audit to allow null user_id and add anon policy
-- This enables pre-authentication voice input testing

-- 1. Make user_id nullable (was NOT NULL before)
ALTER TABLE voice_records_audit
  ALTER COLUMN user_id DROP NOT NULL;

-- 2. Update foreign key to allow null
ALTER TABLE voice_records_audit
  DROP CONSTRAINT IF EXISTS voice_records_audit_user_id_fkey;

ALTER TABLE voice_records_audit
  ADD CONSTRAINT voice_records_audit_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

-- 3. Update existing INSERT policy to allow null user_id for authenticated users
DROP POLICY IF EXISTS "Users can insert their own audit records" ON voice_records_audit;

CREATE POLICY "Users can insert their own audit records"
  ON voice_records_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- 4. Add anon policy for pre-authentication testing
CREATE POLICY "Allow anon to insert audit records with null user_id"
  ON voice_records_audit
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- 5. Update SELECT policy to allow reading null user_id records
DROP POLICY IF EXISTS "Users can view their own audit records" ON voice_records_audit;

CREATE POLICY "Users can view their own audit records"
  ON voice_records_audit
  FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

-- 6. Update UPDATE policy to allow updating records with null user_id
DROP POLICY IF EXISTS "Users can update their own audit records" ON voice_records_audit;

CREATE POLICY "Users can update their own audit records"
  ON voice_records_audit
  FOR UPDATE
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- 7. Grant permissions to anon users
GRANT SELECT, INSERT ON voice_records_audit TO anon;

COMMENT ON COLUMN voice_records_audit.user_id IS 'User ID - nullable to support pre-authentication voice input testing';
