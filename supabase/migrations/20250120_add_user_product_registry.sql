-- User Product Registry Migration
-- Purpose: Build per-user product knowledge base for self-learning classification
-- Phase 2 of robust classification strategy

CREATE TABLE IF NOT EXISTS user_product_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Normalized product identifier (lowercase, trimmed, no special chars)
  product_key TEXT NOT NULL,

  -- User's confirmed classification from actual usage
  event_type TEXT NOT NULL CHECK (event_type IN ('food', 'supplement', 'medication')),

  -- Full product details from most recent entry
  product_name TEXT NOT NULL,
  brand TEXT,

  -- Usage tracking for confidence scoring
  times_logged INTEGER DEFAULT 1,
  first_logged_at TIMESTAMPTZ DEFAULT NOW(),
  last_logged_at TIMESTAMPTZ DEFAULT NOW(),

  -- External product ID if matched from database
  external_product_id TEXT,
  external_source TEXT, -- 'openfoodfacts', 'usda', etc.

  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one entry per user per product
  UNIQUE(user_id, product_key)
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_product_registry_user
  ON user_product_registry(user_id);

-- Index for product key lookups
CREATE INDEX IF NOT EXISTS idx_user_product_registry_key
  ON user_product_registry(user_id, product_key);

-- Index for frequently logged products (fuzzy matching)
CREATE INDEX IF NOT EXISTS idx_user_product_registry_frequent
  ON user_product_registry(user_id, times_logged DESC);

-- Enable Row Level Security
ALTER TABLE user_product_registry ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own product registry
CREATE POLICY user_product_registry_select_policy ON user_product_registry
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own products
CREATE POLICY user_product_registry_insert_policy ON user_product_registry
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own products
CREATE POLICY user_product_registry_update_policy ON user_product_registry
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: Users can delete their own products
CREATE POLICY user_product_registry_delete_policy ON user_product_registry
  FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_product_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
CREATE TRIGGER user_product_registry_updated_at_trigger
  BEFORE UPDATE ON user_product_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_user_product_registry_updated_at();

-- Comment for documentation
COMMENT ON TABLE user_product_registry IS
  'Stores user-specific product classifications learned from confirmed entries. ' ||
  'Used for self-learning classification that improves accuracy over time.';
