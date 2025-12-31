# Barcode Architecture Plan: Product vs. SKU Separation

## Overview

Separate **Product Identity** (nutritional data, ingredients) from **SKUs** (barcodes, packaging variants). This prevents database bloat when the same product has multiple UPCs (90ct bottle, 180ct bottle, 12-pack case).

---

## Product Types & Barcode Behavior

Our catalog handles three product types, each with different barcode patterns:

| Product Type | UPC Recycling Risk | Multi-Package Variants | Example |
|--------------|-------------------|------------------------|---------|
| **Food** | HIGH - Retailers recycle UPCs for seasonal/discontinued items | Common (6-pack, 12-pack, family size) | Nature Valley bars |
| **Supplement** | LOW - Products rarely discontinued, brands maintain UPCs | Very common (30ct, 60ct, 90ct, 180ct) | NOW Magtein |
| **Medication** | VERY LOW - Regulated, NDC codes are stable | Less common (OTC may have multi-packs) | Advil |

### UPC Recycling Handling Strategy

For **food products** where UPC recycling is a real risk:
- Track `last_scanned_at` to detect stale barcodes
- If a scan returns a product not scanned in >18 months AND Gemini detects a different product name, flag for re-verification
- Apply stricter validation based on product_type from the parent product_catalog record

For **supplements/medications**:
- Trust existing barcode associations
- Only flag conflicts if detected product name is completely different (not just packaging variant)

### Amazon FNSKU Barcode Filtering

Products fulfilled by Amazon (FBA) often have Amazon's internal barcode covering the manufacturer's UPC. These **must be rejected**:

| Barcode Type | Pattern | Action |
|--------------|---------|--------|
| **Amazon FNSKU** | Starts with `X00` (10 chars) | ❌ REJECT - internal to Amazon |
| **Amazon LPN** | Starts with `LPN` | ❌ REJECT - warehouse tracking |
| **UPC-A** | 12 digits | ✅ ACCEPT |
| **EAN-13** | 13 digits | ✅ ACCEPT |
| **UPC-E** | 8 digits | ✅ ACCEPT |

**Why reject Amazon barcodes:**
- FNSKU codes are seller-specific (same product from different sellers = different FNSKU)
- They don't map to actual products outside Amazon's system
- They would create false "new products" that are actually duplicates
- Users scanning Amazon-fulfilled products should peel the label or use text search instead

---

## Current State

```
product_catalog
├── barcode TEXT (single barcode per product - PROBLEM)
├── product_key, product_name, brand
├── product_type  ← "food", "supplement", "medication"
├── serving_quantity, serving_unit, serving_weight_grams
├── micros JSONB, active_ingredients JSONB
└── times_logged, verification_status
```

**Problem**: If NOW Magtein has 3 UPCs (90ct, 180ct, case), we'd need 3 rows with duplicate nutrition data.

---

## Target Architecture

```
product_catalog (unchanged nutritional data)
├── id UUID PRIMARY KEY
├── product_key, product_name, brand
├── product_type  ← "food", "supplement", "medication"
├── serving_quantity, serving_unit  ← "3 capsules" or "1 bar" (stays constant)
├── micros, active_ingredients
└── times_logged

product_barcodes (NEW - one-to-many)
├── barcode TEXT PRIMARY KEY
├── product_id UUID → product_catalog(id)
├── total_quantity NUMERIC  ← 90, 180, 1080 (supplements) or 6, 12 (food multipacks)
├── total_unit TEXT  ← "capsules", "tablets", "bars"
├── container_type TEXT  ← "bottle", "box", "case" (optional)
├── last_scanned_at TIMESTAMPTZ
└── needs_reverification BOOLEAN  ← Flag for potentially recycled UPCs (mainly food)
```

**Result**: 1 row in `product_catalog` + N rows in `product_barcodes` = No duplicated nutrition data.

---

## Implementation Plan

### Phase 1: Database Migration ✅ COMPLETED

**File**: `supabase/migrations/20250201_create_product_barcodes.sql`

```sql
-- 1. Create the product_barcodes table
CREATE TABLE product_barcodes (
  barcode TEXT PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES product_catalog(id) ON DELETE CASCADE,

  -- Packaging-specific data
  total_quantity NUMERIC,          -- e.g., 90, 180, 1080 (supplements) or 6, 12 (food)
  total_unit TEXT,                 -- e.g., "capsules", "bars", "tablets"
  container_type TEXT,             -- e.g., "bottle", "box", "case" (nullable)

  -- Tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- UPC recycling protection (primarily for food products)
  needs_reverification BOOLEAN DEFAULT FALSE
);

-- 2. Indexes
CREATE INDEX idx_barcodes_product_id ON product_barcodes(product_id);
CREATE INDEX idx_barcodes_last_scanned ON product_barcodes(last_scanned_at DESC);

-- 3. RLS Policies
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_barcodes_select_policy ON product_barcodes
  FOR SELECT USING (true);

CREATE POLICY product_barcodes_insert_policy ON product_barcodes
  FOR INSERT WITH CHECK (auth.uid() = submitted_by_user_id);

-- 4. Migrate existing barcodes
INSERT INTO product_barcodes (barcode, product_id, submitted_by_user_id, created_at)
SELECT
  barcode,
  id,
  submitted_by_user_id,
  created_at
FROM product_catalog
WHERE barcode IS NOT NULL;

-- 5. Drop barcode from product_catalog (after migration verified)
-- ALTER TABLE product_catalog DROP COLUMN barcode;
-- DROP INDEX IF EXISTS idx_product_catalog_barcode;
-- DROP INDEX IF EXISTS idx_product_catalog_barcode_unique;
```

### Phase 2: Update `lookupByBarcode()` Function ✅ COMPLETED

**File**: `mobile/src/utils/productCatalog.js`

#### 2a. Add Barcode Validation Function

```javascript
/**
 * Validate barcode format and reject non-standard barcodes
 * Rejects Amazon FNSKU, LPN, and other internal warehouse codes
 *
 * @param {string} barcode - Raw barcode string
 * @returns {{ valid: boolean, normalized: string|null, reason?: string }}
 */
export function validateBarcode(barcode) {
  if (!barcode || typeof barcode !== 'string') {
    return { valid: false, normalized: null, reason: 'empty_or_invalid' };
  }

  const cleaned = barcode.trim().toUpperCase();

  // Reject Amazon FNSKU codes (start with X00, typically 10 chars)
  if (cleaned.startsWith('X00')) {
    return {
      valid: false,
      normalized: null,
      reason: 'amazon_fnsku',
      message: 'Amazon FNSKU barcodes cannot be used. Please peel the Amazon label to reveal the manufacturer barcode, or use text search.'
    };
  }

  // Reject Amazon LPN (warehouse tracking) codes
  if (cleaned.startsWith('LPN')) {
    return {
      valid: false,
      normalized: null,
      reason: 'amazon_lpn',
      message: 'Amazon warehouse codes cannot be used. Please use the manufacturer barcode or text search.'
    };
  }

  // Validate standard barcode formats
  const digitsOnly = cleaned.replace(/\D/g, '');

  // UPC-A: 12 digits
  if (digitsOnly.length === 12) {
    return { valid: true, normalized: digitsOnly, format: 'UPC-A' };
  }

  // EAN-13: 13 digits
  if (digitsOnly.length === 13) {
    return { valid: true, normalized: digitsOnly, format: 'EAN-13' };
  }

  // UPC-E: 8 digits
  if (digitsOnly.length === 8) {
    return { valid: true, normalized: digitsOnly, format: 'UPC-E' };
  }

  // Unknown format
  return {
    valid: false,
    normalized: null,
    reason: 'unknown_format',
    message: `Unrecognized barcode format (${digitsOnly.length} digits). Expected UPC-A (12), EAN-13 (13), or UPC-E (8).`
  };
}
```

#### 2b. Update lookupByBarcode()

```javascript
// BEFORE (current)
export async function lookupByBarcode(barcode) {
  const { data } = await supabase
    .from('product_catalog')
    .select('*')
    .eq('barcode', barcode)
    .single();
  return data;
}

// AFTER (new architecture)
export async function lookupByBarcode(barcode) {
  if (!barcode) return null;

  // Validate barcode format (reject Amazon FNSKU, etc.)
  const validation = validateBarcode(barcode);
  if (!validation.valid) {
    console.log(`[lookupByBarcode] Rejected barcode: ${validation.reason}`);
    return {
      error: true,
      reason: validation.reason,
      message: validation.message
    };
  }

  // Step 1: Find barcode in product_barcodes table
  const { data: barcodeRecord, error: barcodeError } = await supabase
    .from('product_barcodes')
    .select(`
      barcode,
      total_quantity,
      total_unit,
      container_type,
      needs_reverification,
      last_scanned_at,
      product:product_catalog(*)
    `)
    .eq('barcode', barcode)
    .single();

  if (barcodeError || !barcodeRecord) {
    return null;
  }

  // Step 2: Update last_scanned_at
  await supabase
    .from('product_barcodes')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('barcode', barcode);

  // Step 3: Increment product usage
  await incrementProductUsage(barcodeRecord.product.id);

  // Step 4: Return merged data
  return {
    ...barcodeRecord.product,
    barcode: barcodeRecord.barcode,
    package_quantity: barcodeRecord.total_quantity,
    package_unit: barcodeRecord.total_unit,
    container_type: barcodeRecord.container_type,
    needs_reverification: barcodeRecord.needs_reverification,
    matchMethod: 'barcode'
  };
}
```

### Phase 3: Update `addProductToCatalog()` Function

When adding a new product with a barcode:

```javascript
export async function addProductToCatalog(productData, userId) {
  const { barcode, package_quantity, ...productFields } = productData;

  // 1. Insert product (without barcode)
  const { data: product, error } = await supabase
    .from('product_catalog')
    .insert({ ...productFields, submitted_by_user_id: userId })
    .select()
    .single();

  if (error) throw error;

  // 2. Insert barcode association (if provided)
  if (barcode) {
    await supabase
      .from('product_barcodes')
      .insert({
        barcode,
        product_id: product.id,
        total_quantity: package_quantity || null,
        total_unit: productData.serving_unit || null,
        submitted_by_user_id: userId
      });
  }

  return { success: true, product };
}
```

### Phase 4: Add New Barcode to Existing Product

New function for when a user scans a different package size of the same product:

```javascript
/**
 * Associate a new barcode with an existing product
 * Use case: User scans 180ct bottle, product exists from 90ct bottle
 */
export async function addBarcodeToProduct(barcode, productId, packagingInfo, userId) {
  const { data, error } = await supabase
    .from('product_barcodes')
    .insert({
      barcode,
      product_id: productId,
      total_quantity: packagingInfo.quantity,
      total_unit: packagingInfo.unit,
      container_type: packagingInfo.containerType,
      submitted_by_user_id: userId
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      // Duplicate barcode - already exists
      return { success: false, error: 'Barcode already registered' };
    }
    throw error;
  }

  return { success: true, barcodeRecord: data };
}
```

### Phase 5: Handle UPC Conflicts (Product-Type Aware)

Different thresholds for food vs supplements/medications:

```javascript
/**
 * Check if a barcode may have been recycled to a different product
 * Uses product_type to determine staleness threshold:
 * - Food: 18 months (higher recycling risk)
 * - Supplement/Medication: 36 months (lower risk)
 */
export async function checkBarcodeConflict(barcode, detectedProductName, detectedBrand) {
  const { data: existing } = await supabase
    .from('product_barcodes')
    .select(`
      last_scanned_at,
      needs_reverification,
      product:product_catalog(product_name, brand, product_type)
    `)
    .eq('barcode', barcode)
    .single();

  if (!existing) return { conflict: false };

  // Already flagged for reverification
  if (existing.needs_reverification) {
    return {
      conflict: true,
      existingProduct: existing.product,
      reason: 'previously_flagged'
    };
  }

  // Determine staleness threshold based on product type
  const stalenessMonths = existing.product.product_type === 'food' ? 18 : 36;
  const stalenessThreshold = new Date();
  stalenessThreshold.setMonth(stalenessThreshold.getMonth() - stalenessMonths);

  const isStale = new Date(existing.last_scanned_at) < stalenessThreshold;

  // Check if detected product name differs significantly
  const existingName = existing.product.product_name.toLowerCase();
  const existingBrand = (existing.product.brand || '').toLowerCase();
  const detectedNameLower = detectedProductName.toLowerCase();
  const detectedBrandLower = (detectedBrand || '').toLowerCase();

  // Names differ if neither contains the other AND brands don't match
  const namesDiffer = !existingName.includes(detectedNameLower) &&
                      !detectedNameLower.includes(existingName);
  const brandsDiffer = existingBrand && detectedBrandLower &&
                       existingBrand !== detectedBrandLower;

  if (isStale && (namesDiffer || brandsDiffer)) {
    // Flag for manual review
    await supabase
      .from('product_barcodes')
      .update({ needs_reverification: true })
      .eq('barcode', barcode);

    return {
      conflict: true,
      existingProduct: existing.product,
      detectedProduct: { name: detectedProductName, brand: detectedBrand },
      reason: 'stale_with_mismatch',
      suggestion: existing.product.product_type === 'food'
        ? 'This food product barcode may have been reassigned. Please verify.'
        : 'Product name mismatch detected. Please verify this is the correct product.'
    };
  }

  return { conflict: false };
}
```

---

## Files to Modify

| File | Changes | Status |
|------|---------|--------|
| `supabase/migrations/20250201_create_product_barcodes.sql` | New migration file | ✅ DONE |
| `mobile/src/utils/productCatalog.js` | Add `validateBarcode()`, update `lookupByBarcode()`, `addProductToCatalog()`, add `addBarcodeToProduct()`, `checkBarcodeConflict()` | Pending |
| `mobile/src/utils/photoEventParser.js` | Handle barcode validation errors in UI flow | Pending |
| `mobile/__tests__/utils/productCatalog.test.js` | Add tests for barcode validation (Amazon FNSKU rejection, UPC formats) | Pending |

---

## Product-Type Specific Examples

### Food Example: Nature Valley Granola Bars

```
product_catalog:
  id: "abc-123"
  product_name: "Oats 'n Honey Crunchy Granola Bars"
  brand: "Nature Valley"
  product_type: "food"
  serving_quantity: 2
  serving_unit: "bars"
  calories: 190
  ...

product_barcodes:
  barcode: "016000275904"  → product_id: "abc-123", total_quantity: 6, total_unit: "bars"
  barcode: "016000487802"  → product_id: "abc-123", total_quantity: 12, total_unit: "bars"
  barcode: "016000487819"  → product_id: "abc-123", total_quantity: 24, total_unit: "bars"
```

### Supplement Example: NOW Magtein

```
product_catalog:
  id: "def-456"
  product_name: "Magtein Magnesium L-Threonate"
  brand: "NOW"
  product_type: "supplement"
  serving_quantity: 3
  serving_unit: "capsules"
  micros: { "Magnesium": { amount: 144, unit: "mg" } }
  ...

product_barcodes:
  barcode: "733739012345"  → product_id: "def-456", total_quantity: 90, total_unit: "capsules"
  barcode: "733739012352"  → product_id: "def-456", total_quantity: 180, total_unit: "capsules"
```

### Medication Example: Advil

```
product_catalog:
  id: "ghi-789"
  product_name: "Advil Ibuprofen"
  brand: "Advil"
  product_type: "medication"
  serving_quantity: 1
  serving_unit: "tablet"
  active_ingredients: [{ name: "Ibuprofen", strength: "200mg", atc_code: "M01AE01" }]
  ...

product_barcodes:
  barcode: "305730154505"  → product_id: "ghi-789", total_quantity: 24, total_unit: "tablets"
  barcode: "305730154512"  → product_id: "ghi-789", total_quantity: 50, total_unit: "tablets"
  barcode: "305730154529"  → product_id: "ghi-789", total_quantity: 100, total_unit: "tablets"
```

---

## Data Model Benefits

1. **No Duplicate Nutrition Data**: One product → many barcodes
2. **Package Awareness**: Know if user scanned a 6-pack or 12-pack of granola bars
3. **Product-Type Aware Validation**: Stricter UPC recycling checks for food products
4. **Usage Analytics**: Track which package sizes are most popular via `last_scanned_at`
5. **Future-Proof**: Easy to add more packaging metadata (price, retailer, etc.)

---

## Migration Safety

1. **Non-destructive**: Create new table, copy data, keep old column until verified
2. **Backward compatible**: Old code continues working during transition
3. **Rollback-safe**: Can drop new table if issues arise

---

## Open Questions

1. **Should `container_type` be an enum or free text?**
   - Recommendation: Free text initially, normalize later if needed

2. **Do we need `total_quantity` for all product types?**
   - Supplements: Yes (90 capsules, 180 capsules)
   - Food: Yes for multipacks (6 bars, 12 bars)
   - Medications: Yes (24 tablets, 50 tablets, 100 tablets)
   - Recommendation: Nullable, populate when available from label

3. **Should we query OpenFoodFacts on unknown barcodes?**
   - Recommendation: Yes, but only on-demand (user scans unknown barcode)
   - Filter by product_type to avoid supplements/medications from food database
   - Don't bulk-import their database

4. **How do we handle the `needs_reverification` flag in the UI?**
   - Option A: Show confirmation dialog: "We have X on file for this barcode, but detected Y. Which is correct?"
   - Option B: Silently log the conflict and let admin review later
   - Recommendation: Option A for food, Option B for supplements/medications
