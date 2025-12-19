-- Fix RLS policies for voice_records_audit table
-- This migration ensures authenticated users can insert their own audit records

-- First, check if the table exists and create it if it doesn't
CREATE TABLE IF NOT EXISTS voice_records_audit (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  record_type TEXT,
  value NUMERIC,
  units TEXT,
  nlp_status TEXT DEFAULT 'pending',
  nlp_model TEXT,
  nlp_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE voice_records_audit ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can insert their own audit records" ON voice_records_audit;
DROP POLICY IF EXISTS "Users can view their own audit records" ON voice_records_audit;
DROP POLICY IF EXISTS "Users can update their own audit records" ON voice_records_audit;

-- Create INSERT policy - Allow authenticated users to insert their own records
CREATE POLICY "Users can insert their own audit records"
  ON voice_records_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create SELECT policy - Allow authenticated users to view their own records
CREATE POLICY "Users can view their own audit records"
  ON voice_records_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Create UPDATE policy - Allow authenticated users to update their own records
CREATE POLICY "Users can update their own audit records"
  ON voice_records_audit
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS voice_records_audit_user_id_idx ON voice_records_audit(user_id);
CREATE INDEX IF NOT EXISTS voice_records_audit_created_at_idx ON voice_records_audit(created_at DESC);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_voice_records_audit_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_voice_records_audit_updated_at ON voice_records_audit;
CREATE TRIGGER update_voice_records_audit_updated_at
  BEFORE UPDATE ON voice_records_audit
  FOR EACH ROW
  EXECUTE FUNCTION update_voice_records_audit_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON voice_records_audit TO authenticated;
