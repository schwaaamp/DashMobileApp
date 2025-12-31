/**
 * Product Catalog Management
 *
 * Handles product lookup, barcode scanning, and photo submission flow.
 * Priority order: User registry → Barcode → Text search → Require photo
 *
 * Key Features:
 * - Zero external API calls (all data from product_catalog table)
 * - Barcode-first matching for instant recognition
 * - Full-text search with popularity ranking
 * - Photo submission with Gemini Vision OCR
 */

import { supabase } from './supabaseClient';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Normalize a product name/brand for matching
 * Lowercases, removes special characters, normalizes whitespace
 *
 * @param {string} text - Product name or brand
 * @returns {string} Normalized text for comparison
 */
export function normalizeProductKey(text) {
  if (!text) return '';

  return text
    .toLowerCase()
    .replace(/[()'"]/g, '')        // Remove parentheses and quotes
    .replace(/[^a-z0-9\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, ' ')          // Normalize multiple spaces
    .trim();
}

/**
 * Validate barcode format and reject non-standard barcodes
 * Rejects Amazon FNSKU, LPN, and other internal warehouse codes
 *
 * @param {string} barcode - Raw barcode string
 * @returns {{ valid: boolean, normalized: string|null, format?: string, reason?: string, message?: string }}
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

/**
 * Find a product in the catalog by barcode or name/brand
 * Uses the new product_barcodes table for barcode lookup
 *
 * Priority:
 * 1. Exact barcode match (if barcode provided and valid)
 * 2. Text search on brand + product name
 *
 * @param {Object} params - Search parameters
 * @param {string} params.barcode - Optional barcode
 * @param {string} params.productName - Product name from detection
 * @param {string} params.brand - Brand name from detection
 * @returns {Promise<Object|null>} Matching product with matchMethod or null
 */
export async function findCatalogMatch({ barcode, productName, brand }) {
  try {
    // Step 1: Try barcode match first (fastest, most accurate)
    if (barcode) {
      const barcodeResult = await lookupByBarcode(barcode);

      // Check if barcode was rejected (e.g., Amazon FNSKU)
      if (barcodeResult?.error) {
        console.log(`[findCatalogMatch] Barcode rejected: ${barcodeResult.reason}`);
        // Fall through to text search
      } else if (barcodeResult) {
        // Found a match via barcode
        return barcodeResult;
      }
    }

    // Step 2: Fall back to text search
    const searchQuery = brand ? `${brand} ${productName}` : productName;

    if (!searchQuery || searchQuery.trim().length === 0) {
      return null;
    }

    // Normalize for search
    const normalizedQuery = normalizeProductKey(searchQuery);

    // Use full-text search with brand normalization
    // Handle "NOW" matching "NOW Foods" by searching both ways
    const { data: textMatches, error: searchError } = await supabase
      .from('product_catalog')
      .select('*')
      .or(`product_key.ilike.%${normalizedQuery}%,product_name.ilike.%${productName}%`)
      .order('times_logged', { ascending: false })
      .limit(5);

    if (searchError) {
      console.error('[findCatalogMatch] Search error:', searchError);
      return null;
    }

    if (!textMatches || textMatches.length === 0) {
      return null;
    }

    // Return best match
    const bestMatch = textMatches[0];

    return {
      ...bestMatch,
      matchMethod: 'text_search'
    };

  } catch (error) {
    console.error('[findCatalogMatch] Error:', error);
    return null;
  }
}

/**
 * Add a new product to the catalog
 * Inserts product data into product_catalog and barcode into product_barcodes
 *
 * @param {Object} productData - Product data from nutrition label extraction
 * @param {string} userId - User who submitted the product
 * @returns {Promise<{success: boolean, product?: Object, error?: string}>}
 */
export async function addProductToCatalog(productData, userId) {
  try {
    const {
      product_name,
      brand,
      product_type,
      serving_quantity,
      serving_unit,
      serving_weight_grams,
      micros,
      active_ingredients,
      barcode,
      package_quantity,  // Total items in package (e.g., 90 capsules)
      photo_front_url,
      photo_label_url
    } = productData;

    // Validate barcode if provided
    let validatedBarcode = null;
    if (barcode) {
      const validation = validateBarcode(barcode);
      if (validation.valid) {
        validatedBarcode = validation.normalized;
      } else {
        console.log(`[addProductToCatalog] Skipping invalid barcode: ${validation.reason}`);
      }
    }

    // Generate product_key for duplicate detection
    const product_key = normalizeProductKey(`${brand || ''} ${product_name}`);

    // Step 1: Insert product into product_catalog (without barcode)
    const { data: product, error: productError } = await supabase
      .from('product_catalog')
      .insert({
        product_name,
        brand,
        product_type,
        product_key,
        serving_quantity,
        serving_unit,
        serving_weight_grams,
        micros: micros || {},
        active_ingredients: active_ingredients || [],
        // Note: barcode field kept for backwards compatibility during migration
        barcode: validatedBarcode,
        photo_front_url,
        photo_label_url,
        submitted_by_user_id: userId,
        verification_status: 'user_verified',
        times_logged: 1
      })
      .select()
      .single();

    if (productError) {
      console.error('[addProductToCatalog] Insert error:', productError);
      return {
        success: false,
        error: productError.message
      };
    }

    // Step 2: Insert barcode into product_barcodes table (if valid)
    if (validatedBarcode) {
      const { error: barcodeError } = await supabase
        .from('product_barcodes')
        .insert({
          barcode: validatedBarcode,
          product_id: product.id,
          total_quantity: package_quantity || null,
          total_unit: serving_unit || null,
          submitted_by_user_id: userId
        });

      if (barcodeError) {
        // Log but don't fail - product was created successfully
        console.error('[addProductToCatalog] Barcode insert error:', barcodeError);
      }
    }

    return {
      success: true,
      product
    };

  } catch (error) {
    console.error('[addProductToCatalog] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Associate a new barcode with an existing product
 * Use case: User scans 180ct bottle, product exists from 90ct bottle
 *
 * @param {string} barcode - UPC/EAN barcode
 * @param {string} productId - Existing product catalog ID
 * @param {Object} packagingInfo - Package details
 * @param {number} packagingInfo.quantity - Total items in package (e.g., 180)
 * @param {string} packagingInfo.unit - Unit type (e.g., "capsules")
 * @param {string} packagingInfo.containerType - Container type (e.g., "bottle")
 * @param {string} userId - User submitting the barcode
 * @returns {Promise<{success: boolean, barcodeRecord?: Object, error?: string}>}
 */
export async function addBarcodeToProduct(barcode, productId, packagingInfo, userId) {
  // Validate barcode format
  const validation = validateBarcode(barcode);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.message || `Invalid barcode: ${validation.reason}`
    };
  }

  try {
    const { data, error } = await supabase
      .from('product_barcodes')
      .insert({
        barcode: validation.normalized,
        product_id: productId,
        total_quantity: packagingInfo?.quantity || null,
        total_unit: packagingInfo?.unit || null,
        container_type: packagingInfo?.containerType || null,
        submitted_by_user_id: userId
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Duplicate barcode - already exists
        return { success: false, error: 'Barcode already registered to another product' };
      }
      throw error;
    }

    return { success: true, barcodeRecord: data };
  } catch (error) {
    console.error('[addBarcodeToProduct] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Search product catalog (does NOT call external APIs)
 *
 * Uses full-text search with popularity ranking.
 * Searches both product name and brand.
 *
 * @param {string} query - Product name or brand
 * @param {string} userId - Current user ID (for logging)
 * @param {number} limit - Max results to return (default: 10)
 * @returns {Promise<Array>} - Matching products from catalog
 */
export async function searchProductCatalog(query, userId, limit = 10) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  try {
    // Split query into individual terms for better matching
    // e.g., "NOW Magtein" -> ["now", "magtein"]
    const terms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);

    if (terms.length === 0) {
      return [];
    }

    // Build OR conditions for each term to match product_name, brand, or product_key
    // This allows "NOW Magtein" to match products where:
    // - product_name contains "magtein" OR
    // - brand contains "now" OR
    // - product_key contains either term
    const orConditions = terms.map(term =>
      `product_name.ilike.%${term}%,brand.ilike.%${term}%,product_key.ilike.%${term}%`
    ).join(',');

    const { data, error } = await supabase
      .from('product_catalog')
      .select('*')
      .or(orConditions)
      .order('times_logged', { ascending: false })  // Popularity ranking
      .limit(limit * 2);  // Fetch more to allow for scoring/filtering

    if (error) {
      console.error('Error searching product catalog:', error);
      throw error;
    }

    // Post-filter: Score results by how many search terms they match
    // Products matching MORE terms rank higher
    const scoredResults = (data || []).map(product => {
      const searchableText = `${product.product_name || ''} ${product.brand || ''} ${product.product_key || ''}`.toLowerCase();
      const matchCount = terms.filter(term => searchableText.includes(term)).length;
      return { ...product, _matchScore: matchCount };
    });

    // Sort by match score (descending), then by times_logged (descending)
    scoredResults.sort((a, b) => {
      if (b._matchScore !== a._matchScore) {
        return b._matchScore - a._matchScore;
      }
      return (b.times_logged || 0) - (a.times_logged || 0);
    });

    // Remove the temporary score field and limit results
    return scoredResults
      .map(({ _matchScore, ...product }) => product)
      .slice(0, limit);
  } catch (error) {
    console.error('Exception in searchProductCatalog:', error);
    return [];
  }
}

/**
 * Lookup product by barcode using the product_barcodes table
 * Validates barcode format and rejects Amazon FNSKU/LPN codes
 *
 * @param {string} barcode - UPC/EAN code (e.g., "012345678901")
 * @returns {Promise<Object|null|{error: boolean, reason: string, message: string}>}
 *   - Product data with packaging info, or
 *   - null if not found, or
 *   - Error object if barcode is invalid (e.g., Amazon FNSKU)
 */
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

  try {
    // Use normalized barcode for lookup
    const normalizedBarcode = validation.normalized;

    // Step 1: Try new product_barcodes table first
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
      .eq('barcode', normalizedBarcode)
      .single();

    if (barcodeRecord && !barcodeError) {
      // Update last_scanned_at timestamp
      await supabase
        .from('product_barcodes')
        .update({ last_scanned_at: new Date().toISOString() })
        .eq('barcode', normalizedBarcode);

      // Increment product usage
      await incrementProductUsage(barcodeRecord.product.id);

      // Return merged data with packaging info
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

    // Step 2: Fall back to legacy barcode column on product_catalog
    // (for backwards compatibility during migration)
    const { data: legacyMatch, error: legacyError } = await supabase
      .from('product_catalog')
      .select('*')
      .eq('barcode', normalizedBarcode)
      .single();

    if (legacyMatch && !legacyError) {
      // Increment usage counter
      await incrementProductUsage(legacyMatch.id);

      return {
        ...legacyMatch,
        matchMethod: 'barcode'
      };
    }

    // Not found in either table
    if (barcodeError?.code === 'PGRST116' || legacyError?.code === 'PGRST116') {
      return null;
    }

    // Unexpected error
    if (barcodeError) {
      console.error('Error looking up barcode in product_barcodes:', barcodeError);
    }
    if (legacyError) {
      console.error('Error looking up barcode in product_catalog:', legacyError);
    }

    return null;
  } catch (error) {
    console.error('Exception in lookupByBarcode:', error);
    return null;
  }
}

/**
 * Submit product via photo (front + label)
 *
 * Flow:
 * 1. Upload front photo to Supabase Storage
 * 2. Upload label photo to Supabase Storage
 * 3. Extract nutrition data from label using Gemini Vision
 * 4. Insert into product_catalog
 * 5. Create audit record in product_submissions
 * 6. Add to user's product registry
 *
 * @param {string} frontPhotoUri - Front package photo URI
 * @param {string} labelPhotoUri - Nutrition Facts label photo URI
 * @param {string} userId - Current user ID
 * @param {string} geminiApiKey - Gemini API key
 * @returns {Promise<{success: boolean, productId: string, error?: string}>}
 */
export async function submitProductPhoto(frontPhotoUri, labelPhotoUri, userId, geminiApiKey) {
  try {
    // Step 1: Upload front photo
    const frontUploadResult = await uploadProductPhoto(frontPhotoUri, userId, 'front');
    if (frontUploadResult.error) {
      throw new Error(`Failed to upload front photo: ${frontUploadResult.error}`);
    }

    // Step 2: Upload label photo
    const labelUploadResult = await uploadProductPhoto(labelPhotoUri, userId, 'label');
    if (labelUploadResult.error) {
      throw new Error(`Failed to upload label photo: ${labelUploadResult.error}`);
    }

    // Step 3: Extract nutrition data from label
    const extractionResult = await extractNutritionLabel(labelPhotoUri, geminiApiKey);

    if (!extractionResult.success) {
      throw new Error(`OCR extraction failed: ${extractionResult.error}`);
    }

    const nutritionData = extractionResult.data;

    // Check confidence threshold
    if (nutritionData.confidence < 70) {
      // Low confidence - create submission for manual review
      const { data: submission, error: submissionError } = await supabase
        .from('product_submissions')
        .insert({
          user_id: userId,
          photo_front_url: frontUploadResult.url,
          photo_label_url: labelUploadResult.url,
          extracted_data: nutritionData,
          gemini_confidence: nutritionData.confidence,
          status: 'pending'
        })
        .select()
        .single();

      if (submissionError) throw submissionError;

      return {
        success: false,
        error: 'Low confidence OCR - submitted for manual review',
        submissionId: submission.id,
        needsManualReview: true
      };
    }

    // Step 4: Check for duplicate barcode
    if (nutritionData.barcode) {
      const existingProduct = await lookupByBarcode(nutritionData.barcode);
      if (existingProduct) {
        // Duplicate found - create submission with 'duplicate' status
        await supabase
          .from('product_submissions')
          .insert({
            user_id: userId,
            photo_front_url: frontUploadResult.url,
            photo_label_url: labelUploadResult.url,
            extracted_data: nutritionData,
            gemini_confidence: nutritionData.confidence,
            status: 'duplicate',
            product_catalog_id: existingProduct.id
          });

        return {
          success: false,
          error: 'Product already exists in catalog',
          existingProduct,
          isDuplicate: true
        };
      }
    }

    // Step 5: Normalize product key
    const { normalizeProductKey } = require('./productRegistry');
    const productKey = normalizeProductKey(nutritionData.product_name);

    // Step 6: Insert into product_catalog
    const { data: product, error: insertError } = await supabase
      .from('product_catalog')
      .insert({
        barcode: nutritionData.barcode,
        product_key: productKey,
        product_name: nutritionData.product_name,
        brand: nutritionData.brand,
        product_type: nutritionData.product_type || 'food',
        serving_quantity: nutritionData.serving_quantity,
        serving_unit: nutritionData.serving_unit,
        serving_weight_grams: nutritionData.serving_weight_grams,
        calories: nutritionData.calories,
        protein: nutritionData.protein,
        carbs: nutritionData.carbs,
        fat: nutritionData.fat,
        fiber: nutritionData.fiber,
        sugar: nutritionData.sugar,
        micros: nutritionData.micros || {},
        active_ingredients: nutritionData.active_ingredients || [],
        photo_front_url: frontUploadResult.url,
        photo_label_url: labelUploadResult.url,
        submitted_by_user_id: userId,
        verification_status: 'unverified'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting product:', insertError);
      throw insertError;
    }

    // Step 7: Create successful submission record
    await supabase
      .from('product_submissions')
      .insert({
        user_id: userId,
        photo_front_url: frontUploadResult.url,
        photo_label_url: labelUploadResult.url,
        extracted_data: nutritionData,
        gemini_confidence: nutritionData.confidence,
        status: 'accepted',
        product_catalog_id: product.id
      });

    // Step 8: Add to user's product registry
    const { addToUserRegistry } = require('./productRegistry');
    await addToUserRegistry(
      userId,
      product.product_name,
      product.brand,
      product.product_type,
      product.id
    );

    return {
      success: true,
      productId: product.id,
      product
    };

  } catch (error) {
    console.error('Error in submitProductPhoto:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Upload product photo to Supabase Storage
 *
 * @param {string} photoUri - Local photo URI
 * @param {string} userId - User ID
 * @param {string} type - 'front' or 'label'
 * @returns {Promise<{url: string, error?: string}>}
 */
async function uploadProductPhoto(photoUri, userId, type) {
  try {
    // Read file as base64
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Determine file extension from URI
    const fileExtension = photoUri.split('.').pop() || 'jpg';
    const fileName = `${userId}/${Date.now()}-${type}.${fileExtension}`;
    const bucket = type === 'front' ? 'product-fronts' : 'product-labels';

    // Convert base64 to blob
    const blob = base64ToBlob(base64, `image/${fileExtension}`);

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, blob, {
        contentType: `image/${fileExtension}`,
        upsert: false
      });

    if (error) {
      console.error(`Error uploading ${type} photo:`, error);
      return { error: error.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return { url: publicUrl };

  } catch (error) {
    console.error(`Exception uploading ${type} photo:`, error);
    return { error: error.message };
  }
}

/**
 * Convert base64 string to Blob
 *
 * @param {string} base64 - Base64 encoded data
 * @param {string} contentType - MIME type
 * @returns {Blob}
 */
function base64ToBlob(base64, contentType) {
  const byteCharacters = atob(base64);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);

    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: contentType });
}

/**
 * Extract nutrition data from label photo using Gemini Vision
 *
 * Prompt is optimized for precise extraction of:
 * - Serving size (split into quantity, unit, grams)
 * - Macronutrients (calories, protein, carbs, fat, fiber, sugar)
 * - Micronutrients (vitamins, minerals)
 * - Active ingredients for medications/supplements
 *
 * @param {string} photoUri - Nutrition Facts label photo URI
 * @param {string} geminiApiKey - Gemini API key
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
export async function extractNutritionLabel(photoUri, geminiApiKey) {
  try {
    // Convert image to base64
    const base64Image = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Determine MIME type
    const fileExtension = photoUri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = fileExtension === 'png' ? 'image/png' : 'image/jpeg';

    const prompt = `Extract nutrition information from this Nutrition Facts label.

CRITICAL REQUIREMENTS:
1. Parse serving size into THREE separate fields:
   - serving_quantity (numeric, e.g., 1)
   - serving_unit (text, e.g., "bar", "cup", "tbsp")
   - serving_weight_grams (numeric, e.g., 42.0)

2. For medications/supplements with MULTIPLE active ingredients:
   - Return an ARRAY of ingredients
   - Example: NyQuil has Acetaminophen + Dextromethorphan + Doxylamine

Return JSON:
{
  "product_name": string,
  "brand": string | null,
  "barcode": string | null,
  "product_type": "food" | "supplement" | "medication",

  "serving_quantity": number,
  "serving_unit": string,
  "serving_weight_grams": number,

  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number,
  "sugar": number,

  "micros": {
    "vitamin_d": {"amount": number, "unit": string},
    "calcium": {"amount": number, "unit": string}
  },

  "active_ingredients": [
    {"name": string, "strength": string}
  ],

  "confidence": 0-100
}

If any field is unclear or not visible, set to null.`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json"
      }
    };

    const visionModel = process.env.EXPO_PUBLIC_GEMINI_VISION_MODEL || 'gemini-2.0-flash-exp';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error('No content in Gemini response');
    }

    const parsed = JSON.parse(content);

    return {
      success: true,
      data: parsed
    };

  } catch (error) {
    console.error('Error extracting nutrition label:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Detect barcode in photo (fallback to Gemini Vision if no native scanner)
 *
 * @param {string} photoUri - Photo containing barcode
 * @param {string} geminiApiKey - Gemini API key
 * @returns {Promise<{barcode: string, format: string, confidence: number} | null>}
 */
export async function detectBarcode(photoUri, geminiApiKey) {
  try {
    const base64Image = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const fileExtension = photoUri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = fileExtension === 'png' ? 'image/png' : 'image/jpeg';

    const prompt = `Detect and extract the barcode from this image.

Look for:
- UPC-A (12 digits)
- EAN-13 (13 digits)
- Other standard product barcodes

Return JSON:
{
  "barcode": string | null,  // Full numeric barcode
  "format": "UPC-A" | "EAN-13" | "unknown" | null,
  "confidence": 0-100
}

If no barcode is visible, return {"barcode": null, "format": null, "confidence": 0}.`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
        responseMimeType: "application/json"
      }
    };

    const visionModel = process.env.EXPO_PUBLIC_GEMINI_VISION_MODEL || 'gemini-2.0-flash-exp';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      return { success: false, barcode: null, error: 'No content from Gemini' };
    }

    const parsed = JSON.parse(content);

    if (parsed.barcode) {
      return { success: true, barcode: parsed.barcode, format: parsed.format, confidence: parsed.confidence };
    }

    return { success: false, barcode: null };

  } catch (error) {
    console.error('Error detecting barcode:', error);
    return { success: false, barcode: null, error: error.message };
  }
}

/**
 * Increment times_logged counter when product is used
 *
 * @param {string} productId - Product catalog ID
 */
export async function incrementProductUsage(productId) {
  if (!productId) return;

  try {
    await supabase.rpc('increment_product_times_logged', {
      product_id: productId
    });
  } catch (error) {
    // Fallback to manual increment if RPC doesn't exist
    try {
      const { data: product } = await supabase
        .from('product_catalog')
        .select('times_logged')
        .eq('id', productId)
        .single();

      if (product) {
        await supabase
          .from('product_catalog')
          .update({ times_logged: product.times_logged + 1 })
          .eq('id', productId);
      }
    } catch (fallbackError) {
      console.error('Error incrementing product usage:', fallbackError);
    }
  }
}
