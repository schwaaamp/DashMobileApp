# Meal Template Learning System - Implementation Plan

## Vision

Transform repetitive multi-item logging into **one-tap shortcuts**. When a user consistently logs the same combination of items together (e.g., "morning supplements", "breakfast shake", "post-workout stack"), the system learns these patterns and offers to log the entire template with a single confirmation.

**Core Principle:** Move users from active data entry → passive confirmation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MEAL TEMPLATE LEARNING SYSTEM                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌──────────────────┐     ┌───────────────────────┐   │
│  │ Event Save   │────▶│ Pattern Detection│────▶│ Template Suggestion   │   │
│  │ (confirm.jsx)│     │ (mealPatterns.js)│     │ (home.jsx)            │   │
│  └──────────────┘     └──────────────────┘     └───────────────────────┘   │
│         │                      │                         │                  │
│         ▼                      ▼                         ▼                  │
│  ┌──────────────┐     ┌──────────────────┐     ┌───────────────────────┐   │
│  │voice_events  │     │user_meal_templates│     │ Template Confirmation │   │
│  │(source of    │     │(confirmed only)  │     │ (templateConfirm.jsx) │   │
│  │ truth)       │     └──────────────────┘     └───────────────────────┘   │
│  └──────────────┘                                                           │
│         │                                                                    │
│         └─────────────────────────────────────────────────────────────────  │
│           Pattern detection queries voice_events directly                    │
│           No intermediate storage needed                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Design Philosophy

### Why Query `voice_events` Directly?

The `voice_events` table is the **source of truth** for what users have logged. Rather than duplicating this data into a separate pattern tracking table, we should:

1. **Query `voice_events` on-demand** to detect patterns
2. **Only persist to `user_meal_templates`** when user explicitly confirms a template
3. **Calculate occurrence counts** from actual event data, not stored counters

**Benefits:**
- No data duplication or sync issues
- Always accurate (reflects actual user behavior)
- Simpler schema (one less table)
- Patterns are computed, not stored

### What We DON'T Need

| Rejected Approach | Why Not |
|-------------------|---------|
| `meal_pattern_history` table | Duplicates data already in `voice_events` |
| `detection_count` column | Can be calculated from `voice_events` query |
| Storing unconfirmed patterns | Query on-demand instead |

---

## Database Schema

### `user_meal_templates` Table (Already Exists)
Located in: `supabase/migrations/20250128_create_product_catalog.sql` (lines 141-162)

```sql
CREATE TABLE user_meal_templates (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),

  template_name TEXT NOT NULL,     -- "Morning Supplements", "Breakfast Shake"
  template_key TEXT NOT NULL,      -- "morning supplements", "breakfast shake"

  items JSONB NOT NULL,            -- [{product_id, quantity, name, event_type, ...}]
  typical_time_range TEXT,         -- "07:00-09:00"

  times_logged INTEGER DEFAULT 1,  -- How many times user USED this template
  first_logged_at TIMESTAMPTZ,
  last_logged_at TIMESTAMPTZ,

  UNIQUE(user_id, template_key)
);
```

**Enhancement Needed:** Add columns for auto-generation tracking:

```sql
-- Migration: 20250129_enhance_meal_templates.sql
ALTER TABLE user_meal_templates ADD COLUMN IF NOT EXISTS
  auto_generated BOOLEAN DEFAULT false;  -- True if system-detected vs manually created

ALTER TABLE user_meal_templates ADD COLUMN IF NOT EXISTS
  fingerprint TEXT;  -- Normalized item fingerprint for matching (e.g., "magtein|omega-3|vitamin-d")

-- Index for fingerprint-based lookups
CREATE INDEX IF NOT EXISTS idx_meal_templates_fingerprint
  ON user_meal_templates(user_id, fingerprint);

-- Index for time-based suggestions
CREATE INDEX IF NOT EXISTS idx_meal_templates_time_user
  ON user_meal_templates(user_id, typical_time_range);
```

### Column Definitions

| Column | Purpose |
|--------|---------|
| `times_logged` | How many times user has **used this template** after creation |
| `auto_generated` | `true` if system detected pattern, `false` if user manually created |
| `fingerprint` | Normalized sorted item IDs for quick pattern matching |

**Note:** We intentionally do NOT have a `detection_count` column. The number of times a pattern was detected before template creation is computed from `voice_events` at query time.

---

## Phase 1: Pattern Detection Engine (Query-Based)

### File: `mobile/src/utils/mealPatterns.js`

**Purpose:** Detect meal patterns by querying existing `voice_events` data.

### Core Functions

#### 1.1 `detectMealPatterns(userId, options)`

Query `voice_events` to find recurring item combinations.

```javascript
/**
 * Analyze voice_events to find recurring meal patterns
 *
 * @param {string} userId - User ID
 * @param {Object} options
 * @param {number} options.timeWindowMinutes - Window for grouping items (default: 30)
 * @param {number} options.minOccurrences - Minimum times pattern must occur (default: 2)
 * @param {number} options.lookbackDays - How far back to analyze (default: 30)
 * @returns {Promise<Array<{fingerprint, items, occurrences, typicalHour}>>}
 */
export async function detectMealPatterns(userId, options = {}) {
  const {
    timeWindowMinutes = 30,
    minOccurrences = 2,
    lookbackDays = 30
  } = options;

  // 1. Fetch recent events
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  const { data: events } = await supabase
    .from('voice_events')
    .select('id, event_type, event_data, event_time, product_catalog_id')
    .eq('user_id', userId)
    .gte('event_time', cutoffDate.toISOString())
    .in('event_type', ['food', 'supplement', 'medication'])
    .order('event_time', { ascending: true });

  // 2. Group events into "sessions" (items logged within timeWindowMinutes of each other)
  const sessions = groupEventsIntoSessions(events, timeWindowMinutes);

  // 3. Generate fingerprints for each session
  const sessionFingerprints = sessions.map(session => ({
    fingerprint: generateMealFingerprint(session.items),
    items: session.items,
    hour: new Date(session.startTime).getHours()
  }));

  // 4. Count fingerprint occurrences
  const fingerprintCounts = countFingerprints(sessionFingerprints);

  // 5. Filter to patterns that meet minimum occurrence threshold
  const patterns = Object.entries(fingerprintCounts)
    .filter(([_, data]) => data.count >= minOccurrences)
    .map(([fingerprint, data]) => ({
      fingerprint,
      items: data.items,
      occurrences: data.count,
      typicalHour: Math.round(data.totalHours / data.count)
    }));

  // 6. Exclude patterns that already exist as templates
  const { data: existingTemplates } = await supabase
    .from('user_meal_templates')
    .select('fingerprint')
    .eq('user_id', userId);

  const existingFingerprints = new Set(existingTemplates?.map(t => t.fingerprint) || []);

  return patterns.filter(p => !existingFingerprints.has(p.fingerprint));
}
```

#### 1.2 `groupEventsIntoSessions(events, windowMinutes)`

Group consecutive events into "meal sessions".

```javascript
/**
 * Group events that were logged within windowMinutes of each other
 *
 * @param {Array} events - Sorted events from voice_events
 * @param {number} windowMinutes - Time window for grouping
 * @returns {Array<{items: Array, startTime: Date, endTime: Date}>}
 */
function groupEventsIntoSessions(events, windowMinutes) {
  if (!events?.length) return [];

  const sessions = [];
  let currentSession = {
    items: [extractItemFromEvent(events[0])],
    startTime: events[0].event_time,
    endTime: events[0].event_time
  };

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    const prevTime = new Date(currentSession.endTime);
    const currTime = new Date(event.event_time);
    const diffMinutes = (currTime - prevTime) / (1000 * 60);

    if (diffMinutes <= windowMinutes) {
      // Same session - add to current
      currentSession.items.push(extractItemFromEvent(event));
      currentSession.endTime = event.event_time;
    } else {
      // New session - save current and start new
      if (currentSession.items.length >= 2) {
        sessions.push(currentSession);
      }
      currentSession = {
        items: [extractItemFromEvent(event)],
        startTime: event.event_time,
        endTime: event.event_time
      };
    }
  }

  // Don't forget last session
  if (currentSession.items.length >= 2) {
    sessions.push(currentSession);
  }

  return sessions;
}
```

#### 1.3 `generateMealFingerprint(items)`

Create a normalized identifier for a set of items.

```javascript
/**
 * Create a sortable, comparable fingerprint from items
 * Uses product_catalog_id when available, falls back to normalized name
 *
 * @param {Array} items - Array of {product_id, name, event_type}
 * @returns {string} - Normalized fingerprint like "uuid-123|uuid-456|vitamin-d"
 */
export function generateMealFingerprint(items) {
  return items
    .map(item => item.product_id || normalizeProductKey(item.name))
    .sort()
    .join('|');
}
```

#### 1.4 `calculatePatternSimilarity(fingerprint1, fingerprint2)`

Jaccard similarity for partial template matching.

```javascript
/**
 * Calculate how similar two meal patterns are
 * Used for suggesting existing templates when user logs partial match
 *
 * @returns {number} - Similarity score 0-1
 */
export function calculatePatternSimilarity(fingerprint1, fingerprint2) {
  const set1 = new Set(fingerprint1.split('|'));
  const set2 = new Set(fingerprint2.split('|'));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}
```

#### 1.5 `checkForPatternMatch(userId, currentItems)`

Check if items being logged match an existing template OR a detected pattern.

```javascript
/**
 * Check if current items match a template or emerging pattern
 * Called during event logging to offer shortcuts
 *
 * @param {string} userId
 * @param {Array} currentItems - Items user is about to log
 * @returns {Promise<{type: 'template'|'pattern'|null, data?: Object, similarity: number}>}
 */
export async function checkForPatternMatch(userId, currentItems) {
  const currentFingerprint = generateMealFingerprint(currentItems);

  // 1. Check existing templates first (confirmed patterns)
  const { data: templates } = await supabase
    .from('user_meal_templates')
    .select('*')
    .eq('user_id', userId);

  for (const template of templates || []) {
    const similarity = calculatePatternSimilarity(currentFingerprint, template.fingerprint);
    if (similarity >= 0.7) {  // 70% match threshold
      return {
        type: 'template',
        data: template,
        similarity
      };
    }
  }

  // 2. Check for emerging patterns (not yet templates)
  const patterns = await detectMealPatterns(userId, { minOccurrences: 2 });

  for (const pattern of patterns) {
    const similarity = calculatePatternSimilarity(currentFingerprint, pattern.fingerprint);
    if (similarity >= 0.7) {
      return {
        type: 'pattern',
        data: pattern,
        similarity
      };
    }
  }

  return { type: null, similarity: 0 };
}
```

---

## Phase 2: Template Creation (Confirmed Only)

Templates are ONLY created when user explicitly confirms. No "draft" or "pending" templates.

#### 2.1 `createTemplateFromPattern(userId, pattern, templateName)`

```javascript
/**
 * Create a confirmed template from a detected pattern
 * Called when user accepts a pattern suggestion
 *
 * @param {string} userId
 * @param {Object} pattern - Pattern data from detectMealPatterns
 * @param {string} templateName - User-provided name
 * @returns {Promise<Object>} - Created template
 */
export async function createTemplateFromPattern(userId, pattern, templateName) {
  // Generate time range from typical hour (±1 hour window)
  const startHour = Math.max(0, pattern.typicalHour - 1);
  const endHour = Math.min(23, pattern.typicalHour + 1);
  const timeRange = `${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:59`;

  const { data: template, error } = await supabase
    .from('user_meal_templates')
    .insert({
      user_id: userId,
      template_name: templateName,
      template_key: normalizeProductKey(templateName),
      fingerprint: pattern.fingerprint,
      items: pattern.items,
      typical_time_range: timeRange,
      times_logged: 0,  // User hasn't used it via template yet
      first_logged_at: new Date().toISOString(),
      auto_generated: true
    })
    .select()
    .single();

  if (error) throw error;
  return template;
}
```

---

## Phase 3: Template Suggestion UI

### 3.1 Home Screen Integration (`home.jsx`)

Add proactive template suggestions based on time of day.

```javascript
// In home.jsx, add after user check

const [suggestedTemplate, setSuggestedTemplate] = useState(null);

useEffect(() => {
  if (user?.id) {
    checkForTemplateSuggestion();
  }
}, [user?.id]);

const checkForTemplateSuggestion = async () => {
  const { getSuggestedTemplate } = require('@/utils/mealPatterns');
  const template = await getSuggestedTemplate(user.id);

  if (template) {
    setSuggestedTemplate(template);
  }
};
```

#### `getSuggestedTemplate(userId)`

```javascript
/**
 * Get a template to suggest based on current time
 * Only suggests templates that have been used at least once
 */
export async function getSuggestedTemplate(userId) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentTime = `${String(currentHour).padStart(2, '0')}:00`;

  // Find templates matching current time window
  // Only suggest templates that exist (all templates in this table are confirmed)
  const { data: templates } = await supabase
    .from('user_meal_templates')
    .select('*')
    .eq('user_id', userId)
    .order('times_logged', { ascending: false });

  // Filter by time range
  const matching = templates?.filter(t => {
    if (!t.typical_time_range) return false;
    const [start, end] = t.typical_time_range.split('-');
    return currentTime >= start && currentTime <= end;
  });

  // Don't suggest if already logged today
  if (matching?.length > 0) {
    const template = matching[0];
    const alreadyLoggedToday = await checkIfLoggedToday(userId, template.id);
    return alreadyLoggedToday ? null : template;
  }

  return null;
}

/**
 * Check if user already logged this template today
 */
async function checkIfLoggedToday(userId, templateId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('voice_events')
    .select('id')
    .eq('user_id', userId)
    .eq('template_id', templateId)
    .gte('event_time', today.toISOString())
    .limit(1);

  return data?.length > 0;
}
```

### 3.2 Template Suggestion Card Component

New component: `mobile/src/components/TemplateSuggestionCard.jsx`

```javascript
/**
 * Proactive template suggestion card shown on home screen
 */
export default function TemplateSuggestionCard({ template, onAccept, onDismiss }) {
  const colors = useColors();

  // Calculate total nutrition from items
  const totals = useMemo(() => {
    return template.items.reduce((acc, item) => ({
      calories: acc.calories + (item.calories || 0),
      protein: acc.protein + (item.protein || 0),
      items: acc.items + 1
    }), { calories: 0, protein: 0, items: 0 });
  }, [template.items]);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onAccept}
    >
      <View style={styles.header}>
        <Ionicons name="flash" size={20} color={colors.primary} />
        <Text style={styles.title}>Log your {template.template_name}?</Text>
      </View>

      <Text style={styles.subtitle}>
        {totals.items} items • {totals.calories} cal
      </Text>

      <View style={styles.itemsPreview}>
        {template.items.slice(0, 3).map((item, i) => (
          <Text key={i} style={styles.itemName}>{item.name}</Text>
        ))}
        {template.items.length > 3 && (
          <Text style={styles.more}>+{template.items.length - 3} more</Text>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity onPress={onAccept} style={styles.acceptButton}>
          <Text style={styles.acceptText}>Log Now</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}
```

### 3.3 Template Confirmation Screen

New screen: `mobile/src/app/template-confirm.jsx`

When user accepts a template suggestion, show a quick confirmation screen:

```javascript
export default function TemplateConfirmScreen() {
  const params = useLocalSearchParams();
  const template = JSON.parse(params.template);

  const [itemQuantities, setItemQuantities] = useState(
    template.items.reduce((acc, item, i) => {
      acc[i] = item.default_quantity || 1;
      return acc;
    }, {})
  );

  const handleConfirm = async () => {
    // Create events for all items
    const events = template.items.map((item, i) => ({
      event_type: item.event_type,
      event_data: buildEventData(item, itemQuantities[i]),
      template_id: template.id
    }));

    await createMultipleEvents(events, user.id);
    await incrementTemplateUsage(template.id);

    // Success feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <View>
      <Header title={template.template_name} />

      <ScrollView>
        {template.items.map((item, i) => (
          <TemplateItemRow
            key={i}
            item={item}
            quantity={itemQuantities[i]}
            onQuantityChange={(q) => setItemQuantities({...itemQuantities, [i]: q})}
          />
        ))}
      </ScrollView>

      <TouchableOpacity onPress={handleConfirm}>
        <Text>Log {template.items.length} Items</Text>
      </TouchableOpacity>
    </View>
  );
}
```

---

## Phase 4: Voice/Text Template Matching

### 4.1 Template Detection from Natural Language

Detect when user says something like "my morning vitamins" or "usual breakfast".

Add to `voiceEventParser.js`:

```javascript
/**
 * Check if user input matches a meal template name
 */
export async function matchTemplateByVoice(transcription, userId) {
  const normalized = transcription.toLowerCase().trim();

  // Common template trigger phrases
  const triggers = [
    /^(my |the |usual |regular |normal )?(.+?)( routine| stack| combo| meal)?$/i,
    /^log (my )?(.+)$/i,
    /^(took |had |ate )(my )?(.+)$/i
  ];

  let potentialName = null;
  for (const trigger of triggers) {
    const match = normalized.match(trigger);
    if (match) {
      potentialName = (match[2] || match[3] || '').trim();
      break;
    }
  }

  if (!potentialName) return null;

  // Search templates (all templates in this table are confirmed by design)
  const { data: templates } = await supabase
    .from('user_meal_templates')
    .select('*')
    .eq('user_id', userId);

  // Fuzzy match template names
  const matches = templates?.filter(t => {
    const templateKey = t.template_key.toLowerCase();
    const searchKey = normalizeProductKey(potentialName);

    return templateKey.includes(searchKey) ||
           searchKey.includes(templateKey) ||
           calculateSimilarity(templateKey, searchKey) > 0.7;
  });

  if (matches?.length > 0) {
    // Return best match by times_logged
    return matches.sort((a, b) => b.times_logged - a.times_logged)[0];
  }

  return null;
}
```

### 4.2 Integration with Voice Handler

Update `home.jsx` handleVoicePress:

```javascript
// After transcription, before Gemini parsing
const templateMatch = await matchTemplateByVoice(parsed.transcription, userId);

if (templateMatch) {
  console.log(`Matched template: ${templateMatch.template_name}`);

  // Navigate to template confirmation
  router.push({
    pathname: '/template-confirm',
    params: { template: JSON.stringify(templateMatch) }
  });
  return;
}

// Continue with normal parsing if no template match...
```

---

## Phase 5: Pattern Detection After Event Save

### 5.1 Integration Point in confirm.jsx

After events are successfully saved, check if we've now hit the threshold for a new pattern:

```javascript
// In handleConfirm, after createVoiceEvent succeeds:

const handleConfirm = async () => {
  // ... existing event creation code ...

  // After successful save, check for emerging patterns
  const { checkForNewPatterns } = require('@/utils/mealPatterns');
  const newPatterns = await checkForNewPatterns(user.id, { minOccurrences: 2 });

  if (newPatterns.length > 0) {
    // Show pattern detection prompt for the most recent pattern
    showPatternDetectedModal(newPatterns[0]);
  }
};
```

### 5.2 Pattern Detected Modal

```javascript
const showPatternDetectedModal = (pattern) => {
  Alert.alert(
    'Save as Quick Log?',
    `You've logged these ${pattern.items.length} items together ${pattern.occurrences} times. Save as a template for one-tap logging?`,
    [
      { text: 'Not Now', style: 'cancel' },
      {
        text: 'Save Template',
        onPress: () => promptForTemplateName(pattern)
      }
    ]
  );
};

const promptForTemplateName = (pattern) => {
  // Navigate to template naming screen
  router.push({
    pathname: '/create-template',
    params: { pattern: JSON.stringify(pattern) }
  });
};
```

### 5.3 `checkForNewPatterns(userId, options)`

```javascript
/**
 * Check if any new patterns have reached the threshold since last check
 * Uses voice_events as source of truth - no separate storage needed
 *
 * @param {string} userId
 * @param {Object} options
 * @returns {Promise<Array>} - Patterns that just reached threshold
 */
export async function checkForNewPatterns(userId, options = {}) {
  // Query voice_events to detect patterns
  const patterns = await detectMealPatterns(userId, options);

  // Filter to patterns not already saved as templates
  // (detectMealPatterns already excludes existing templates)

  return patterns;
}
```

---

## Phase 6: Template Management Screen

### New Screen: `mobile/src/app/templates.jsx`

Allow users to view, edit, and delete their meal templates.

```javascript
export default function TemplatesScreen() {
  const { data: user } = useUser();
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    loadTemplates();
  }, [user?.id]);

  const loadTemplates = async () => {
    const { data } = await supabase
      .from('user_meal_templates')
      .select('*')
      .eq('user_id', user.id)
      .order('times_logged', { ascending: false });

    setTemplates(data || []);
  };

  return (
    <View>
      <Header title="Meal Templates" />

      <FlatList
        data={templates}
        renderItem={({ item }) => (
          <TemplateCard
            template={item}
            onPress={() => router.push({
              pathname: '/template-confirm',
              params: { template: JSON.stringify(item) }
            })}
            onEdit={() => router.push({
              pathname: '/edit-template',
              params: { templateId: item.id }
            })}
            onDelete={() => deleteTemplate(item.id)}
          />
        )}
      />

      <TouchableOpacity
        onPress={() => router.push('/create-template')}
        style={styles.createButton}
      >
        <Text>Create New Template</Text>
      </TouchableOpacity>
    </View>
  );
}
```

---

## Phase 7: Learning Feedback Loop

### 7.1 Template Usage Tracking

```javascript
/**
 * Increment template usage and update last_logged_at
 */
export async function incrementTemplateUsage(templateId) {
  const { data: template } = await supabase
    .from('user_meal_templates')
    .select('times_logged')
    .eq('id', templateId)
    .single();

  await supabase
    .from('user_meal_templates')
    .update({
      times_logged: template.times_logged + 1,
      last_logged_at: new Date().toISOString()
    })
    .eq('id', templateId);
}
```

### 7.2 Quantity Learning

When user modifies template quantities, learn the new defaults:

```javascript
/**
 * Update template with new default quantities based on user selections
 */
export async function learnTemplateQuantities(templateId, newQuantities) {
  const { data: template } = await supabase
    .from('user_meal_templates')
    .select('items')
    .eq('id', templateId)
    .single();

  // Weighted average of old and new quantities
  const updatedItems = template.items.map((item, i) => {
    const oldQty = item.default_quantity || 1;
    const newQty = newQuantities[i] || oldQty;

    // 70% weight to historical, 30% to new
    const learned = Math.round((oldQty * 0.7 + newQty * 0.3) * 10) / 10;

    return { ...item, default_quantity: learned };
  });

  await supabase
    .from('user_meal_templates')
    .update({ items: updatedItems })
    .eq('id', templateId);
}
```

---

## Implementation Phases

### Phase 1: Foundation
1. Create `mealPatterns.js` with core pattern detection
2. Add migration for `user_meal_templates` enhancements (fingerprint, auto_generated columns)
3. Implement `generateMealFingerprint()` and `calculatePatternSimilarity()`
4. Implement `groupEventsIntoSessions()` and `detectMealPatterns()`

### Phase 2: Pattern Detection & Suggestion
1. Implement `checkForNewPatterns()`
2. Integrate pattern detection into confirm.jsx (after event save)
3. Create pattern detected modal UI
4. Create template naming screen (`create-template.jsx`)

### Phase 3: Template Suggestions
1. Create `TemplateSuggestionCard` component
2. Implement `getSuggestedTemplate()` time-based logic
3. Integrate suggestion card into home.jsx
4. Create template confirmation screen (`template-confirm.jsx`)

### Phase 4: Voice Integration
1. Implement `matchTemplateByVoice()`
2. Integrate with handleVoicePress in home.jsx
3. Add template trigger phrase detection
4. Test voice-based template logging

### Phase 5: Management & Polish
1. Create templates management screen (`templates.jsx`)
2. Implement template editing (`edit-template.jsx`)
3. Add quantity learning feedback loop
4. Polish UI and add haptics

---

## Phase 8: Cross-Day Sequence Patterns (Future Enhancement)

Beyond same-session meal templates, users may have **sequential patterns** that span time:

### Examples
- "I always take my evening supplements 30 minutes after dinner"
- "I take Vitamin D with breakfast, then Magnesium before bed"
- "After my morning coffee, I take my thyroid medication"

### Concept: Sequence Templates

```javascript
/**
 * A sequence template represents items that are always logged in order,
 * but not necessarily at the same time.
 */
const sequenceTemplate = {
  id: 'uuid',
  user_id: 'uuid',
  sequence_name: 'Daily Vitamin Routine',

  // Ordered steps with relative timing
  steps: [
    {
      item: { product_id: 'vitamin-d-uuid', name: 'Vitamin D3' },
      timing: 'morning',           // Approximate time of day
      trigger: 'with_meal',        // When to suggest
      typical_hour: 8
    },
    {
      item: { product_id: 'magnesium-uuid', name: 'Magnesium' },
      timing: 'evening',
      trigger: 'before_bed',
      typical_hour: 21,
      delay_from_previous: null    // Not directly after previous
    }
  ],

  // Tracking
  times_completed: 15,             // Full sequence completions
  completion_rate: 0.85            // 85% of days user completes full sequence
};
```

### Detection Algorithm

```javascript
/**
 * Detect cross-day sequential patterns
 * Looks for items that are ALWAYS logged on the same days, in consistent order
 */
export async function detectSequencePatterns(userId, options = {}) {
  const { lookbackDays = 30, minCompletionRate = 0.7 } = options;

  // 1. Get all events grouped by day
  const eventsByDay = await getEventsByDay(userId, lookbackDays);

  // 2. For each unique product, find what OTHER products appear on the same days
  const coOccurrenceMatrix = buildCoOccurrenceMatrix(eventsByDay);

  // 3. Find pairs/groups with high co-occurrence rate
  const frequentPairs = findFrequentPairs(coOccurrenceMatrix, minCompletionRate);

  // 4. Determine typical ordering within each day
  const orderedSequences = determineOrdering(frequentPairs, eventsByDay);

  return orderedSequences;
}
```

### UI: Sequence Reminders

Unlike meal templates (instant logging), sequence templates become **reminders**:

- User logs "Vitamin D" in morning
- System tracks: "Step 1 of Daily Vitamin Routine complete"
- In evening, shows reminder: "Don't forget your Magnesium (part of Daily Vitamin Routine)"

### Why This Is Different from Meal Templates

| Meal Templates | Sequence Templates |
|----------------|-------------------|
| Items logged within 30 min | Items logged across hours/day |
| One-tap logs ALL items | Reminders for each step |
| Same-time grouping | Same-day ordering |
| "Log your Breakfast?" | "Step 2: Take Magnesium" |

### Implementation Notes

This is a **future enhancement** that builds on the meal template foundation:
1. First implement meal templates (same-session)
2. Collect data on cross-day patterns
3. Add sequence detection as Phase 8
4. Consider push notifications for step reminders

---

## Testing Strategy

### Unit Tests
- `mealPatterns.test.js`: Pattern fingerprinting, similarity calculation, session grouping
- `templateMatching.test.js`: Voice-to-template matching

### Integration Tests
- Pattern detection after event saves
- Template creation flow
- Time-based suggestion accuracy
- Partial match suggestions (4 of 5 items)

### E2E Tests
- Full flow: Log items → Pattern detected → Create template → Use template

---

## Success Metrics

1. **Adoption Rate:** % of users with at least one template
2. **Template Usage:** Templates logged per user per week
3. **Time Savings:** Average seconds saved per template use vs. manual logging
4. **Pattern Detection Accuracy:** % of suggested patterns users accept
5. **Learning Improvement:** Quantity accuracy over time

---

## Files to Create/Modify

### New Files
- `mobile/src/utils/mealPatterns.js` - Pattern detection engine (queries voice_events)
- `mobile/src/components/TemplateSuggestionCard.jsx` - Suggestion UI
- `mobile/src/app/template-confirm.jsx` - Template logging confirmation
- `mobile/src/app/templates.jsx` - Template management screen
- `mobile/src/app/create-template.jsx` - Manual template creation
- `mobile/src/app/edit-template.jsx` - Template editing
- `mobile/__tests__/utils/mealPatterns.test.js` - Pattern tests
- `supabase/migrations/20250129_enhance_meal_templates.sql` - Add fingerprint, auto_generated columns

### Modified Files
- `mobile/src/app/(tabs)/home.jsx` - Template suggestions, voice matching
- `mobile/src/app/confirm.jsx` - Pattern detection after save
- `mobile/src/utils/voiceEventParser.js` - Template voice matching
- `mobile/src/utils/photoEventParser.js` - Pattern detection for multi-item

---

## Resolved Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Time Window | 30 minutes | Reasonable for meal/supplement sessions |
| Occurrence Threshold | 2 times | Lower friction to create templates |
| Partial Matches | Yes (70%+ similarity) | Suggest template if user logs most items |
| Intermediate Storage | None - query voice_events | Source of truth, no sync issues |

---

## Summary

The Meal Template Learning System transforms DashMobileApp from a logging tool into an intelligent health companion that learns user habits and offers proactive shortcuts.

**Key Design Principles:**
1. **voice_events is the source of truth** - patterns are computed, not stored separately
2. **Only confirmed templates are persisted** - no draft/pending state
3. **2 occurrences = suggestion threshold** - low friction to create templates
4. **Partial matching enabled** - 4 of 5 items still suggests the template

By detecting repeated patterns and offering one-tap logging, we dramatically reduce friction for consistent health routines while maintaining the flexibility for ad-hoc logging.
