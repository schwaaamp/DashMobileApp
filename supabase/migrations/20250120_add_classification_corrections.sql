-- Classification Corrections Migration
-- Purpose: Learn from user corrections when they select different products than AI suggested
-- Phase 4 of robust classification strategy

CREATE TABLE IF NOT EXISTS classification_corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What the user said (raw input)
  user_input TEXT NOT NULL,

  -- What AI initially classified as
  ai_event_type TEXT NOT NULL,
  ai_confidence INTEGER,

  -- What user actually selected/confirmed
  corrected_event_type TEXT NOT NULL,
  selected_product_id TEXT,
  selected_product_name TEXT,
  selected_product_brand TEXT,

  -- Audit trail
  voice_record_audit_id INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_classification_corrections_user
  ON classification_corrections(user_id);

-- Index for input pattern matching
CREATE INDEX IF NOT EXISTS idx_classification_corrections_input
  ON classification_corrections(user_id, user_input);

-- Index for analyzing correction patterns
CREATE INDEX IF NOT EXISTS idx_classification_corrections_types
  ON classification_corrections(ai_event_type, corrected_event_type);

-- Enable Row Level Security
ALTER TABLE classification_corrections ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own corrections
CREATE POLICY classification_corrections_select_policy ON classification_corrections
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own corrections
CREATE POLICY classification_corrections_insert_policy ON classification_corrections
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own corrections
CREATE POLICY classification_corrections_delete_policy ON classification_corrections
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comment for documentation
COMMENT ON TABLE classification_corrections IS
  'Stores cases where users corrected AI classification by selecting different products. ' ||
  'Used for learning patterns and improving future classifications.';

COMMENT ON COLUMN classification_corrections.ai_event_type IS
  'Event type that AI initially classified (food, supplement, medication)';

COMMENT ON COLUMN classification_corrections.corrected_event_type IS
  'Event type user actually selected (based on product chosen)';

COMMENT ON COLUMN classification_corrections.user_input IS
  'Original user input text that was misclassified';
