-- Meal Template Learning System Enhancement
-- Adds fingerprint and auto_generated columns for pattern detection
-- Also adds template_id to voice_events for tracking template usage

-- ============================================================================
-- 1. ENHANCE user_meal_templates TABLE
-- ============================================================================

-- Add auto_generated column to distinguish system-detected vs manually created templates
ALTER TABLE user_meal_templates ADD COLUMN IF NOT EXISTS
  auto_generated BOOLEAN DEFAULT false;

-- Add fingerprint column for pattern matching
-- Normalized sorted item IDs: "magtein|omega-3|vitamin-d"
ALTER TABLE user_meal_templates ADD COLUMN IF NOT EXISTS
  fingerprint TEXT;

-- Index for fingerprint-based lookups (finding existing templates by pattern)
CREATE INDEX IF NOT EXISTS idx_meal_templates_fingerprint
  ON user_meal_templates(user_id, fingerprint);

-- Index for time-based suggestions (finding templates for current time of day)
CREATE INDEX IF NOT EXISTS idx_meal_templates_time_user
  ON user_meal_templates(user_id, typical_time_range);

-- ============================================================================
-- 2. ADD template_id TO voice_events
-- ============================================================================

-- Track which template was used to create an event (for "already logged today" check)
ALTER TABLE voice_events ADD COLUMN IF NOT EXISTS
  template_id UUID REFERENCES user_meal_templates(id) ON DELETE SET NULL;

-- Index for checking template usage by day
CREATE INDEX IF NOT EXISTS idx_voice_events_template
  ON voice_events(user_id, template_id, event_time)
  WHERE template_id IS NOT NULL;

-- ============================================================================
-- 3. COMMENTS
-- ============================================================================

COMMENT ON COLUMN user_meal_templates.auto_generated IS
  'True if template was detected by the system from repeated patterns, false if manually created by user.';

COMMENT ON COLUMN user_meal_templates.fingerprint IS
  'Normalized sorted item identifiers for pattern matching. Format: "product-id-1|product-id-2|normalized-name". ' ||
  'Used for Jaccard similarity calculation when detecting if current items match an existing template.';

COMMENT ON COLUMN voice_events.template_id IS
  'Reference to user_meal_templates if this event was created via template logging. ' ||
  'Used to check if user has already logged a template today.';
