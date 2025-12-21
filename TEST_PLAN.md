# Test Plan: Voice, Photo, and Text Event Logging

## Important Note: Database Schema Clarification

Based on code analysis, the current database schema uses:

- **`voice_records_audit`** - Stores raw input, transcription, and parsing metadata
- **`voice_events`** - Stores final structured events with normalized data

**Decision:** We will use the existing `voice_events` table for all test assertions. The tests will verify that events are properly stored with the correct `record_type`, `value`, and `units` in the `event_data` JSON field.

---

## Test Cases Overview

### Test 1: Voice Command - Product Recognition with Phonetic Matching

### Test 2: Photo Input - Supplement with Follow-up Question (EXPECTED TO FAIL)

### Test 3: Text Input - Time Range Parsing

### Test 4: Voice Command - Insulin Logging

### Test 5: Voice Command - Multiple Food Items with Serving Size Estimation

---

## Test Case 1: Voice Command - "lemonade element pack"

**Goal:** Verify phonetic matching correctly identifies "element" as "LMNT" brand

### Setup

```javascript
// Mock audio file containing: "lemonade element pack"
const mockAudioTranscription = "lemonade element pack";
const mockUserId = "test-user-123";
```

### Test Steps

1. Simulate voice recording containing "lemonade element pack"
2. Send to `parseAudioWithGemini()`
3. Verify product search triggers via `shouldSearchProducts()`
4. Verify `searchAllProducts()` creates phonetic variations: ["lmnt lemonade pack", "lemonade lmnt pack"]
5. Verify Open Food Facts returns LMNT products with high confidence
6. User navigates to confirmation screen
7. User selects LMNT Lemonade product
8. User confirms event

### Expected Database State

**voice_records_audit table:**

```javascript
{
  user_id: "test-user-123",
  raw_text: "lemonade element pack",
  record_type: "food",
  value: 1,
  units: "pack",
  nlp_status: "awaiting_user_clarification_success",
  nlp_model: "gemini-2.5-flash",
  nlp_metadata: {
    capture_method: "voice",
    confidence: 85,
    transcription: "lemonade element pack",
    product_search_performed: true
  }
}
```

**voice_events table:**

```javascript
{
  user_id: "test-user-123",
  event_type: "food",
  event_data: {
    description: "LMNT Lemonade",
    serving_size: "1 pack",
    calories: 0,
    carbs: 0,
    protein: 0,
    fat: 0
  },
  event_time: "2025-12-18T...",  // Current timestamp
  source_record_id: "<audit_id>",
  capture_method: "voice"
}
```

### Assertions

- ✅ Phonetic matching creates "lmnt" variation from "element"
- ✅ Product search returns LMNT brand products
- ✅ Confirmation screen shows LMNT options
- ✅ voice_events.event_type = "food"
- ✅ voice_events.event_data.description contains "LMNT"
- ✅ voice_events.event_data.serving_size = "1 pack"
- ✅ voice_records_audit stores value=1, units="pack"

---

## Test Case 2: Photo Input - NOW Magtein Supplement (EXPECTED TO FAIL)

**Goal:** Verify photo analysis can identify supplement and prompt for quantity

### Current Implementation Gap

The `/api/photo/analyze` endpoint is **not implemented**. This test will fail until:

1. Backend implements image recognition (OCR + product matching)
2. System adds follow-up question capability for missing fields

### Setup

```javascript
const photoPath =
  "/Users/schwaaamp/DashMobileApp/mobile/__tests__/now_magtein.png";
const mockUserId = "test-user-123";
```

### Test Steps

1. User captures photo of NOW Magtein bottle
2. Photo uploaded to cloud storage
3. System calls `/api/photo/analyze` with image URL
4. **[FAILS HERE]** API should return: `{ event_type: "supplement", event_data: { name: "NOW Magtein", dosage: null, units: null } }`
5. **[NEW FEATURE NEEDED]** System detects missing `dosage` field
6. **[NEW FEATURE NEEDED]** System prompts user: "How many capsules did you take?"
7. User inputs: "2"
8. System creates event with dosage=2, units="capsules"

### Expected Database State (After Implementation)

**voice_records_audit table:**

```javascript
{
  user_id: "test-user-123",
  raw_text: "NOW Magtein (Magnesium L-Threonate)",
  record_type: "supplement",
  value: null,  // Initially null
  units: null,  // Initially null
  nlp_status: "awaiting_user_clarification",
  nlp_model: "vision-ocr",
  nlp_metadata: {
    capture_method: "photo",
    image_url: "https://...",
    product_identified: true,
    missing_fields: ["dosage", "units"]
  }
}
```

**After user provides "2 capsules":**

**voice_events table:**

```javascript
{
  user_id: "test-user-123",
  event_type: "supplement",
  event_data: {
    name: "NOW Magtein",
    dosage: "2",
    units: "capsules"
  },
  event_time: "2025-12-18T...",
  source_record_id: "<audit_id>",
  capture_method: "photo"
}
```

### Assertions (After Implementation)

- ❌ **CURRENTLY FAILS**: `/api/photo/analyze` not implemented
- ❌ **CURRENTLY FAILS**: No follow-up question mechanism exists
- ✅ OCR should extract "NOW Magtein" from image
- ✅ System should recognize this as a supplement
- ✅ System should prompt for missing dosage
- ✅ voice_events.event_type = "supplement"
- ✅ voice_events.event_data.dosage = "2"
- ✅ voice_events.event_data.units = "capsules"

### Implementation Checklist

- [ ] Build `/api/photo/analyze` endpoint with OCR (Google Vision API / Tesseract)
- [ ] Add product database lookup from OCR text
- [ ] Create follow-up question UI component
- [ ] Add state management for multi-step input flow
- [ ] Update confirmation screen to handle missing required fields

---

## Test Case 3: Text Input - "sauna 2-2:25pm"

**Goal:** Verify time range parsing and duration calculation

### Setup

```javascript
const textInput = "sauna 2-2:25pm";
const mockUserId = "test-user-123";
const currentTime = new Date("2025-12-18T14:00:00Z"); // 2pm today
```

### Test Steps

1. User enters text: "sauna 2-2:25pm"
2. Send to `parseTextWithGemini()`
3. Gemini extracts:
   - event_type: "sauna"
   - duration: 25 minutes
   - time_info: { type: "time_range", start: "2:00pm", end: "2:25pm" }
4. `calculateEventTime()` determines event_time as 2:00pm today
5. Create audit record with duration=25
6. Save to voice_events

### Expected Database State

**voice_records_audit table:**

```javascript
{
  user_id: "test-user-123",
  raw_text: "sauna 2-2:25pm",
  record_type: "sauna",
  value: 25,
  units: "minutes",
  nlp_status: "parsed",
  nlp_model: "gemini-2.5-flash",
  nlp_metadata: {
    capture_method: "manual",
    confidence: 95,
    time_range_detected: true
  }
}
```

**voice_events table:**

```javascript
{
  user_id: "test-user-123",
  event_type: "sauna",
  event_data: {
    duration: "25",
    temperature: null,
    temperature_units: null
  },
  event_time: "2025-12-18T14:00:00Z",
  source_record_id: "<audit_id>",
  capture_method: "manual"
}
```

### Assertions

- ✅ Time range "2-2:25pm" correctly parsed as 25 minute duration
- ✅ Event time set to start of range (2:00pm)
- ✅ voice_events.event_type = "sauna"
- ✅ voice_events.event_data.duration = "25"
- ✅ voice_records_audit stores value=25, units="minutes"

---

## Test Case 4: Voice Command - "6 units basal insulin"

**Goal:** Verify insulin logging with correct units

### Setup

```javascript
const mockAudioTranscription = "6 units basal insulin";
const mockUserId = "test-user-123";
```

### Test Steps

1. Simulate voice recording: "6 units basal insulin"
2. Send to `parseAudioWithGemini()`
3. Gemini extracts:
   - event_type: "insulin"
   - value: 6
   - units: "units"
   - insulin_type: "basal"
4. No product search needed (not food/supplement/medication)
5. Save directly to database

### Expected Database State

**voice_records_audit table:**

```javascript
{
  user_id: "test-user-123",
  raw_text: "6 units basal insulin",
  record_type: "insulin",
  value: 6,
  units: "units",
  nlp_status: "parsed",
  nlp_model: "gemini-2.5-flash",
  nlp_metadata: {
    capture_method: "voice",
    confidence: 98,
    product_search_performed: false
  }
}
```

**voice_events table:**

```javascript
{
  user_id: "test-user-123",
  event_type: "insulin",
  event_data: {
    value: "6",
    units: "units",
    insulin_type: "basal",
    site: null
  },
  event_time: "2025-12-18T...",
  source_record_id: "<audit_id>",
  capture_method: "voice"
}
```

### Assertions

- ✅ Insulin type correctly identified as "basal"
- ✅ No product search triggered (insulin is not searchable)
- ✅ voice_events.event_type = "insulin"
- ✅ voice_events.event_data.value = "6"
- ✅ voice_events.event_data.units = "units"
- ✅ voice_events.event_data.insulin_type = "basal"
- ✅ voice_records_audit stores value=6, units="units"

---

## Test Case 5: Voice Command - "chicken thigh, broccoli, and wegmans hummus"

**Goal:** Verify multi-item parsing and serving size estimation

### Current Challenge: Serving Size Estimation

The test requires:

- **Record 1**: chicken thigh → value=1, units="unit" (count-based)
- **Record 2**: broccoli → value=[average_serving_size], units=[average_serving_size_units]
- **Record 3**: wegmans hummus → value=[average_serving_size], units=[average_serving_size_units]

### Proposed Serving Size Strategy

**Option 1: User History-Based Estimation (RECOMMENDED)**

```javascript
// Look at user's past logs for the same item
function estimateServingFromHistory(userId, itemDescription) {
  // Query voice_records for past entries with similar raw_text
  // Calculate median serving size from user's history
  // If user typically logs "broccoli: 1 cup", use that
  // If no history, fall back to database defaults
}
```

**Option 2: Product Database Defaults**

```javascript
// Use serving sizes from USDA/Open Food Facts
// USDA typical servings:
// - Broccoli: 1 cup (91g)
// - Hummus: 2 tablespoons (30g)
// - Chicken thigh: 1 piece (~100g)
```

**Option 3: AI-Powered Contextual Estimation**

```javascript
// Include in Gemini prompt:
// "If serving size is not specified, estimate based on:
// 1. User's typical portion sizes (provided from history)
// 2. Standard USDA serving sizes
// 3. Context clues (e.g., 'snack' vs 'meal')"
```

**Option 4: Hybrid Approach (BEST)**

```javascript
async function estimateServing(userId, itemDescription, eventContext) {
  // 1. Check user history first
  const userMedian = await getUserMedianServing(userId, itemDescription);
  if (userMedian) return userMedian;

  // 2. Check product database
  const productDefault = await getProductDefaultServing(itemDescription);
  if (productDefault) return productDefault;

  // 3. Use AI estimation with context
  const aiEstimate = await geminiEstimateServing(itemDescription, eventContext);
  if (aiEstimate) return aiEstimate;

  // 4. Fall back to generic defaults
  return { value: 1, units: "serving" };
}
```

### Recommended Implementation

**Step 1: Modify Gemini Prompt**

```javascript
// In voiceEventParser.js, add to system prompt:
`
When a user mentions multiple food items without quantities:
1. Extract each item as a separate food entry
2. For count-based items (e.g., "chicken thigh", "apple"), use units="unit" and value=1
3. For volume/weight items (e.g., "broccoli", "hummus"), estimate standard serving:
   - Vegetables: 1 cup or 100g
   - Condiments/spreads: 2 tablespoons or 30g
   - Include both value and units in your response
`;
```

**Step 2: Create Serving Size Lookup Table**

```javascript
// Add to geminiParser.js or new servingSizeDefaults.js
const STANDARD_SERVINGS = {
  // Vegetables (default: 1 cup cooked)
  broccoli: { value: 1, units: "cup", grams: 91 },
  carrots: { value: 1, units: "cup", grams: 128 },
  spinach: { value: 1, units: "cup", grams: 30 },

  // Proteins (default: 1 piece or 100g)
  "chicken thigh": { value: 1, units: "unit", grams: 100 },
  "chicken breast": { value: 1, units: "unit", grams: 120 },

  // Condiments (default: 2 tablespoons)
  hummus: { value: 2, units: "tablespoons", grams: 30 },
  "peanut butter": { value: 2, units: "tablespoons", grams: 32 },
};

function getStandardServing(itemName) {
  const normalized = itemName.toLowerCase().trim();
  return (
    STANDARD_SERVINGS[normalized] || { value: 1, units: "serving", grams: null }
  );
}
```

**Step 3: Store Individual Events**

```javascript
// Modify createVoiceEvent to handle multi-item foods
async function createMultiItemFoodEvent(userId, items, eventTime, auditId) {
  for (const item of items) {
    const serving = item.serving_size
      ? item.serving_size
      : getStandardServing(item.description);

    // Create separate voice_events entry for each item
    await createVoiceEvent(
      userId,
      "food",
      {
        description: item.description,
        serving_size: `${serving.value} ${serving.units}`,
        calories: item.calories || null,
        protein: item.protein || null,
        carbs: item.carbs || null,
        fat: item.fat || null,
      },
      eventTime,
      auditId,
      "voice"
    );
  }
}
```

### Test Steps

1. User speaks: "chicken thigh, broccoli, and wegmans hummus"
2. Gemini parses as multi-item food event
3. For each item, estimate serving size:
   - chicken thigh → 1 unit (count-based)
   - broccoli → 1 cup (standard vegetable serving)
   - wegmans hummus → 2 tablespoons (product search may refine)
4. Product search for "wegmans hummus" to get exact nutrition
5. Create 3 separate voice_records entries
6. Link all to same audit record

### Expected Database State

**voice_records_audit table:**

```javascript
{
  user_id: "test-user-123",
  raw_text: "chicken thigh, broccoli, and wegmans hummus",
  record_type: "food",
  value: 3,  // Number of items
  units: "items",
  nlp_status: "parsed",
  nlp_model: "gemini-2.5-flash",
  nlp_metadata: {
    capture_method: "voice",
    multi_item_count: 3,
    items: ["chicken thigh", "broccoli", "wegmans hummus"]
  }
}
```

**voice_events table (3 separate entries):**

_Event 1:_

```javascript
{
  event_type: "food",
  event_data: {
    description: "chicken thigh",
    serving_size: "1 unit",
    calories: 150,  // From USDA default
    protein: 20,
    carbs: 0,
    fat: 8
  },
  source_record_id: "<audit_id>",
  capture_method: "voice"
}
```

_Event 2:_

```javascript
{
  event_type: "food",
  event_data: {
    description: "broccoli",
    serving_size: "1 cup",
    calories: 55,
    protein: 4,
    carbs: 11,
    fat: 0.6
  },
  source_record_id: "<audit_id>",
  capture_method: "voice"
}
```

_Event 3:_

```javascript
{
  event_type: "food",
  event_data: {
    description: "Wegmans Hummus",
    serving_size: "2 tablespoons",
    calories: 70,
    protein: 2,
    carbs: 4,
    fat: 5
  },
  source_record_id: "<audit_id>",
  capture_method: "voice"
}
```

### Assertions

- ✅ Three separate events created in voice_events
- ✅ Event 1: description="chicken thigh", serving_size="1 unit"
- ✅ Event 2: description="broccoli", serving_size="1 cup"
- ✅ Event 3: description="Wegmans Hummus", serving_size="2 tablespoons"
- ✅ All three linked to same source_record_id (audit_id)
- ✅ Product search performed for Wegmans Hummus
- ✅ Nutritional data populated from USDA/product database

---

## Serving Size Estimation: Final Recommendation

### Best Strategy: Hybrid Multi-Source Approach

```javascript
class ServingSizeEstimator {
  async estimate(userId, itemDescription, context = {}) {
    // Priority 1: User's personal history (most accurate)
    const userPattern = await this.getUserPattern(userId, itemDescription);
    if (userPattern && userPattern.confidence > 0.7) {
      return {
        value: userPattern.median_value,
        units: userPattern.common_units,
        source: "user_history",
        confidence: userPattern.confidence,
      };
    }

    // Priority 2: Product database exact match
    const productMatch = await this.getProductServing(itemDescription);
    if (productMatch && productMatch.confidence > 0.8) {
      return {
        value: productMatch.serving_value,
        units: productMatch.serving_units,
        source: "product_database",
        confidence: productMatch.confidence,
      };
    }

    // Priority 3: USDA standard serving sizes
    const usdaStandard = this.getUSDAStandard(itemDescription);
    if (usdaStandard) {
      return {
        value: usdaStandard.value,
        units: usdaStandard.units,
        source: "usda_standard",
        confidence: 0.6,
      };
    }

    // Priority 4: AI contextual estimation
    const aiEstimate = await this.geminiEstimate(itemDescription, context);
    if (aiEstimate) {
      return {
        value: aiEstimate.value,
        units: aiEstimate.units,
        source: "ai_estimate",
        confidence: aiEstimate.confidence,
      };
    }

    // Fallback: Generic serving
    return {
      value: 1,
      units: "serving",
      source: "default",
      confidence: 0.3,
    };
  }

  async getUserPattern(userId, item) {
    // Query last 30 days of voice_records for same item
    // Calculate median value and most common units
    // Return null if fewer than 3 data points
  }

  async getProductServing(itemDescription) {
    // Search USDA + Open Food Facts
    // Return serving size from best match
  }

  getUSDAStandard(itemDescription) {
    // Lookup in STANDARD_SERVINGS table
    // Match by category (vegetable, protein, grain, etc.)
  }

  async geminiEstimate(itemDescription, context) {
    // Send to Gemini with prompt:
    // "Estimate typical serving size for [item] in a [meal_context]"
    // Parse response for value + units
  }
}
```

### Why This Approach Works

1. **Personalized**: Uses the user's own logging patterns first
2. **Accurate**: Falls back to verified product databases
3. **Flexible**: AI can handle novel foods not in databases
4. **Transparent**: Tracks confidence and source for each estimate
5. **Improvable**: Gets more accurate as user logs more data

### Implementation Priority

1. **Phase 1** (Minimum Viable):

   - USDA standard serving lookup table
   - Gemini prompt enhancement for serving estimation
   - Multi-item parsing logic

2. **Phase 2** (Enhanced):

   - Product database integration for serving sizes
   - Multi-item parsing and record creation
   - Confidence scoring

3. **Phase 3** (Personalized):
   - User history analysis
   - Learning from corrections
   - Smart suggestions based on patterns

---

## Test File Structure

```
mobile/__tests__/
├── voice-events/
│   ├── voice-phonetic-matching.test.js     (Test 1)
│   ├── voice-insulin-logging.test.js       (Test 4)
│   └── voice-multi-item-food.test.js       (Test 5)
├── photo-events/
│   └── photo-supplement-followup.test.js   (Test 2 - EXPECTED FAIL)
├── text-events/
│   └── text-time-range.test.js             (Test 3)
└── utils/
    └── serving-size-estimator.test.js      (Unit tests for estimator)
```

Each test file should:

- Mock Supabase client
- Mock Gemini API responses
- Verify database inserts with exact expected values
- Test error cases and edge conditions
- Include confidence scoring validation

---

## Summary

This plan covers all 5 test scenarios with detailed expectations. The key insight for multi-item serving sizes is to use a **hybrid estimation strategy** that prioritizes user history, falls back to product databases, and uses AI for novel items. Test 2 (photo + follow-up) will fail until photo analysis and interactive clarification are implemented.
