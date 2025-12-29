-- Product Catalog System Migration
-- Purpose: Crowd-sourced product database with barcode support, USDA seeding, and WHO ATC medication tracking
-- Phase 1 of photo-based health event capture

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PRODUCT CATALOG (Main Table)
-- ============================================================================
CREATE TABLE product_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- IDENTIFICATION
  barcode TEXT,               -- UPC/EAN for instant matching (nullable - not all products have barcodes)
  product_key TEXT NOT NULL,  -- Normalized: "nature valley oats honey granola bar"
  product_name TEXT NOT NULL, -- Display: "Nature Valley Oats & Honey Granola Bar"
  brand TEXT,                 -- "General Mills"
  product_type TEXT NOT NULL CHECK (product_type IN ('food', 'supplement', 'medication')),

  -- QUANTITY & SERVING MATH (enables "user ate 2.5 bars" calculation)
  serving_quantity NUMERIC,      -- e.g., 1
  serving_unit TEXT,             -- e.g., "bar", "cup", "tablet", "capsule"
  serving_weight_grams NUMERIC,  -- e.g., 42.0 (crucial for precise scaling)

  -- NUTRITION (Food & Supplements)
  calories NUMERIC,
  protein NUMERIC,              -- grams
  carbs NUMERIC,                -- grams
  fat NUMERIC,                  -- grams
  fiber NUMERIC,                -- grams
  sugar NUMERIC,                -- grams

  -- Extended nutrients (vitamins, minerals, caffeine, etc.)
  -- Structure: {"vitamin_d": {"amount": 20, "unit": "mcg"}, "caffeine": {"amount": 95, "unit": "mg"}}
  micros JSONB DEFAULT '{}'::jsonb,

  -- MEDICINE & SUPPLEMENTS (handles multi-ingredient drugs like NyQuil)
  -- Structure: [{"name": "Ibuprofen", "strength": "200mg", "atc_code": "M01AE01"}]
  active_ingredients JSONB DEFAULT '[]'::jsonb,

  -- METADATA
  photo_front_url TEXT,         -- Front of package photo (for visual recognition)
  photo_label_url TEXT,         -- Nutrition Facts label (source of truth)
  submitted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'user_verified', 'admin_verified')),
  times_logged INTEGER DEFAULT 0,  -- Popularity metric

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- CONSTRAINTS
  UNIQUE(product_key, brand)  -- Prevent duplicate text entries
);

-- INDEXES
-- Partial unique index for barcode (allows multiple NULL barcodes for generic items)
CREATE UNIQUE INDEX idx_product_catalog_barcode_unique ON product_catalog(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_product_catalog_barcode ON product_catalog(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_product_catalog_key ON product_catalog(product_key);
CREATE INDEX idx_product_catalog_brand ON product_catalog(brand, product_key) WHERE brand IS NOT NULL;
CREATE INDEX idx_product_catalog_type ON product_catalog(product_type);

-- GIN index for JSONB active_ingredients (fast searches for ATC codes)
CREATE INDEX idx_product_catalog_ingredients ON product_catalog USING gin (active_ingredients);

-- Full-text search for brand/name typing
CREATE INDEX idx_product_catalog_fts ON product_catalog
  USING gin(to_tsvector('english', product_name || ' ' || COALESCE(brand, '')));

-- Rank by popularity for autocomplete suggestions
CREATE INDEX idx_product_catalog_popular ON product_catalog(times_logged DESC);

-- ROW LEVEL SECURITY
ALTER TABLE product_catalog ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read the catalog (public resource)
CREATE POLICY product_catalog_select_policy ON product_catalog
  FOR SELECT
  USING (true);

-- Policy: Authenticated users can submit products
CREATE POLICY product_catalog_insert_policy ON product_catalog
  FOR INSERT
  WITH CHECK (auth.uid() = submitted_by_user_id);

-- Policy: Users can update their own unverified submissions
CREATE POLICY product_catalog_update_policy ON product_catalog
  FOR UPDATE
  USING (auth.uid() = submitted_by_user_id AND verification_status = 'unverified')
  WITH CHECK (auth.uid() = submitted_by_user_id);

-- COMMENTS
COMMENT ON TABLE product_catalog IS
  'Crowd-sourced product database. Seeded with USDA generics, expanded via user photo submissions. ' ||
  'Supports barcode lookup, multi-ingredient medications via JSONB, and precise serving math.';

COMMENT ON COLUMN product_catalog.serving_quantity IS
  'Numeric portion of serving size (e.g., 1 in "1 bar"). Enables math: calories_consumed = (qty_eaten / serving_quantity) * calories';

COMMENT ON COLUMN product_catalog.active_ingredients IS
  'JSONB array of active ingredients for medications/supplements. ' ||
  'Example: [{"name": "Ibuprofen", "strength": "200mg", "atc_code": "M01AE01"}]. ' ||
  'Handles multi-ingredient drugs like cold medicine.';

-- ============================================================================
-- 2. WHO ATC CODES (Reference Table)
-- ============================================================================
CREATE TABLE atc_codes (
  code TEXT PRIMARY KEY,           -- e.g., "M01AE01"
  name TEXT NOT NULL,              -- e.g., "Ibuprofen"
  category TEXT,                   -- e.g., "Musculo-skeletal system / Anti-inflammatory"
  ddd NUMERIC,                     -- Defined Daily Dose (WHO standard)
  ddd_unit TEXT,                   -- e.g., "g" or "mg"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_atc_codes_name ON atc_codes(LOWER(name));  -- Case-insensitive name search

-- ROW LEVEL SECURITY
ALTER TABLE atc_codes ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read ATC codes (reference data)
CREATE POLICY atc_codes_select_policy ON atc_codes
  FOR SELECT
  USING (true);

-- COMMENTS
COMMENT ON TABLE atc_codes IS
  'WHO Anatomical Therapeutic Chemical classification system. ' ||
  'Used to normalize medication ingredients internationally (e.g., Advil → Ibuprofen M01AE01).';

COMMENT ON COLUMN atc_codes.ddd IS
  'Defined Daily Dose: assumed average maintenance dose per day for a drug used for its main indication in adults. ' ||
  'Used to flag if user is taking significantly above/below standard dosage.';

-- ============================================================================
-- 3. USER MEAL TEMPLATES
-- ============================================================================
CREATE TABLE user_meal_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  template_name TEXT NOT NULL,    -- User-provided name: "Breakfast", "Post-workout shake"
  template_key TEXT NOT NULL,     -- Normalized for matching: "breakfast"

  -- Items in this meal: [{"product_id": "uuid", "quantity": 2, "name": "eggs", "calories": 140}, ...]
  items JSONB NOT NULL,

  -- Optional time-of-day hint (not required for matching, just for proactive suggestions)
  typical_time_range TEXT,        -- e.g., "07:00-09:00"

  times_logged INTEGER DEFAULT 1,
  first_logged_at TIMESTAMPTZ DEFAULT NOW(),
  last_logged_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, template_key)
);

-- INDEXES
CREATE INDEX idx_meal_templates_user ON user_meal_templates(user_id);
CREATE INDEX idx_meal_templates_time ON user_meal_templates(user_id, typical_time_range)
  WHERE typical_time_range IS NOT NULL;
CREATE INDEX idx_meal_templates_frequent ON user_meal_templates(user_id, times_logged DESC);

-- ROW LEVEL SECURITY
ALTER TABLE user_meal_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY meal_templates_select_policy ON user_meal_templates
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY meal_templates_insert_policy ON user_meal_templates
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY meal_templates_update_policy ON user_meal_templates
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY meal_templates_delete_policy ON user_meal_templates
  FOR DELETE
  USING (auth.uid() = user_id);

-- COMMENTS
COMMENT ON TABLE user_meal_templates IS
  'User-specific meal patterns learned from repeated logging (3+ times). ' ||
  'Enables one-tap logging: user photographs breakfast → "Log your Breakfast?" → Done.';

COMMENT ON COLUMN user_meal_templates.items IS
  'JSONB array of meal items. Structure: [{"product_id": "uuid", "quantity": 2, "name": "eggs", "calories": 140}, ...]. ' ||
  'Stores denormalized data (name, calories) for performance - full nutrition recalculated from product_catalog on log.';

-- ============================================================================
-- 4. PRODUCT SUBMISSIONS (Audit Trail)
-- ============================================================================
CREATE TABLE product_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  product_catalog_id UUID REFERENCES product_catalog(id) ON DELETE SET NULL,

  -- Raw data from user submission
  photo_front_url TEXT NOT NULL,
  photo_label_url TEXT NOT NULL,

  -- OCR extraction result
  extracted_data JSONB,
  gemini_confidence INTEGER,      -- 0-100 confidence score from Gemini Vision

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'duplicate')),
  rejection_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_product_submissions_user ON product_submissions(user_id);
CREATE INDEX idx_product_submissions_status ON product_submissions(status);
CREATE INDEX idx_product_submissions_created ON product_submissions(created_at DESC);

-- ROW LEVEL SECURITY
ALTER TABLE product_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_submissions_select_policy ON product_submissions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY product_submissions_insert_policy ON product_submissions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- COMMENTS
COMMENT ON TABLE product_submissions IS
  'Audit trail for user photo submissions. Tracks OCR extraction and acceptance status. ' ||
  'Used for quality control and debugging OCR issues.';

-- ============================================================================
-- 5. TRIGGER FUNCTION: Auto-update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_product_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_catalog_updated_at_trigger
  BEFORE UPDATE ON product_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_product_catalog_updated_at();

CREATE OR REPLACE FUNCTION update_meal_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meal_templates_updated_at_trigger
  BEFORE UPDATE ON user_meal_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_meal_templates_updated_at();

-- ============================================================================
-- 6. RPC FUNCTION: Increment product usage counter
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_product_times_logged(product_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE product_catalog
  SET times_logged = times_logged + 1
  WHERE id = product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
