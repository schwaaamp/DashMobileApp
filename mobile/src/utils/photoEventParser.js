/**
 * Photo Event Parser
 *
 * Orchestrates photo capture → event creation flow with automatic catalog building.
 *
 * Flow:
 * 1. User takes photo of supplement/food/medication bottle
 * 2. Attempt barcode detection (instant match)
 * 3. If no barcode or no match, use Gemini Vision OCR
 * 4. Search product catalog for match
 * 5. If found: ask quantity, create event
 * 6. If not found: 2-photo flow (front + nutrition), add to catalog, then create event
 */

import { analyzeSupplementPhoto, uploadPhotoToSupabase, generateFollowUpQuestion } from './photoAnalysis';
import { lookupByBarcode, searchProductCatalog, incrementProductUsage, detectBarcode, addProductToCatalog } from './productCatalog';
import { createAuditRecord, updateAuditStatus, createVoiceEvent } from './voiceEventParser';
import { calculateConsumedNutrients } from './nutrientCalculation';
import { supabase } from './supabaseClient';

/**
 * Find product in catalog by barcode or name
 * Barcode-first matching for instant recognition
 *
 * @param {string} photoUri - Photo URI for barcode detection
 * @param {string} productName - Product name from Gemini Vision
 * @param {string} brand - Brand name from Gemini Vision
 * @param {string} userId - User ID
 * @param {string} geminiApiKey - Gemini API key
 * @returns {Promise<Object|null>} Catalog match or null
 */
async function findCatalogMatch(photoUri, productName, brand, userId, geminiApiKey) {
  try {
    // Step 1: Attempt barcode detection (fastest path)
    console.log('[photoEventParser] Attempting barcode detection...');
    const barcodeResult = await detectBarcode(photoUri, geminiApiKey);

    if (barcodeResult.success && barcodeResult.barcode) {
      console.log(`[photoEventParser] Barcode detected: ${barcodeResult.barcode}`);

      // Look up by barcode
      const barcodeMatch = await lookupByBarcode(barcodeResult.barcode, userId);

      if (barcodeMatch) {
        console.log('[photoEventParser] ✓ Barcode match found in catalog!');
        return {
          ...barcodeMatch,
          matchMethod: 'barcode'
        };
      }
    }

    // Step 2: Fall back to text search
    console.log('[photoEventParser] No barcode match, searching by text...');
    const searchQuery = brand ? `${brand} ${productName}` : productName;
    const searchResults = await searchProductCatalog(searchQuery, userId, 5);

    if (searchResults.length === 0) {
      console.log('[photoEventParser] No catalog match found');
      return null;
    }

    // Return best match (highest ranked)
    const bestMatch = searchResults[0];

    // Confidence threshold: only return if confidence is reasonable
    if (bestMatch.search_rank && bestMatch.search_rank > 0.3) {
      console.log(`[photoEventParser] ✓ Text match found: ${bestMatch.product_name}`);
      return {
        ...bestMatch,
        matchMethod: 'text_search'
      };
    }

    console.log('[photoEventParser] Match confidence too low');
    return null;
  } catch (error) {
    console.error('[photoEventParser] Error finding catalog match:', error);
    return null;
  }
}

/**
 * Main photo → event processing function
 * Orchestrates: photo upload → Gemini analysis → catalog lookup → event creation
 *
 * @param {string} photoPath - Local photo URI
 * @param {string} userId - User ID
 * @param {string} apiKey - Gemini API key
 * @param {string} captureMethod - Capture method (default: 'photo')
 * @returns {Promise<Object>} Processing result with event data and follow-up question
 */
export async function processPhotoInput(photoPath, userId, apiKey, captureMethod = 'photo') {
  try {
    console.log('[photoEventParser] Processing photo for event creation...');

    // Step 1: Upload photo to Supabase Storage
    console.log('[photoEventParser] Uploading photo to Supabase Storage...');
    const { url: photoUrl, error: uploadError } = await uploadPhotoToSupabase(photoPath, userId);

    if (uploadError) {
      console.error('[photoEventParser] Photo upload failed:', uploadError);
      return {
        success: false,
        error: `Failed to upload photo: ${uploadError}`
      };
    }
    console.log('[photoEventParser] Photo uploaded:', photoUrl);

    // Step 2: Analyze photo with Gemini Vision (multi-item detection)
    console.log('[photoEventParser] Analyzing photo with Gemini Vision...');
    const analysis = await analyzeSupplementPhoto(photoPath, userId, apiKey);

    if (!analysis.success || analysis.items.length === 0) {
      console.error('[photoEventParser] Photo analysis failed:', analysis.error);
      return {
        success: false,
        error: analysis.error || 'Could not identify any products in the photo'
      };
    }

    console.log(`[photoEventParser] Detected ${analysis.items.length} item(s):`, analysis.items);

    // Step 3: Process FIRST item only (multi-item will be Phase 6)
    const detectedItem = analysis.items[0];
    const { name, brand, form, event_type } = detectedItem;

    // Step 4: Search product catalog for match (barcode-first, then text)
    console.log('[photoEventParser] Searching product catalog...');
    const catalogMatch = await findCatalogMatch(photoPath, name, brand, userId, apiKey);

    let productCatalogId = null;
    let servingSize = null;
    let nutrients = null;

    // Determine if we need nutrition label photo (for new products)
    const requiresNutritionLabel = !catalogMatch &&
      (event_type === 'supplement' || event_type === 'medication' || event_type === 'food');

    if (catalogMatch) {
      console.log('[photoEventParser] ✓ Found catalog match:', catalogMatch.product_name);
      productCatalogId = catalogMatch.id;
      servingSize = catalogMatch.serving_size;
      nutrients = catalogMatch.micros; // Use micros field from catalog

      // Increment usage counter
      await incrementProductUsage(productCatalogId);
    } else if (requiresNutritionLabel) {
      console.log('[photoEventParser] No catalog match found. Will require nutrition label photo.');
    } else {
      console.log('[photoEventParser] No catalog match found. Will create event without catalog link.');
    }

    // Step 5: Create audit record
    console.log('[photoEventParser] Creating audit record...');
    const auditRecord = await createAuditRecord(
      userId,
      `[Photo: ${name}${brand ? ` by ${brand}` : ''}]`, // Descriptive text for photo events
      event_type, // eventType
      null, // value
      null, // units
      'gemini-2.0-flash-exp', // nlpModel
      {
        photo_url: photoUrl,
        detected_items: analysis.items,
        confidence: analysis.confidence,
        capture_method: captureMethod,
        gemini_model: 'gemini-2.0-flash-exp',
        catalog_match: catalogMatch ? {
          product_id: productCatalogId,
          product_name: catalogMatch.product_name,
          brand: catalogMatch.brand,
          match_method: catalogMatch.matchMethod
        } : null
      }
    );

    const auditId = auditRecord.id;
    console.log('[photoEventParser] Audit record created:', auditId);

    // Step 6: Build event data structure
    const eventData = buildEventDataFromDetection(
      detectedItem,
      productCatalogId,
      servingSize,
      nutrients
    );

    // Step 7: Generate follow-up question for quantity
    const followUpQuestion = generateQuantityQuestion(name, form || 'capsules');

    // Step 8: Return incomplete event for confirmation screen
    // If no catalog match, require nutrition label photo first
    if (requiresNutritionLabel) {
      return {
        success: true,
        requiresNutritionLabel: true,
        parsed: {
          event_type,
          event_data: eventData,
          confidence: analysis.confidence,
          complete: false
        },
        auditId,
        photoUrl, // Front photo URL - save for catalog entry
        complete: false,
        detectedItem,
        catalogMatch: null
      };
    }

    // Catalog match found - just need quantity
    return {
      success: true,
      requiresNutritionLabel: false,
      parsed: {
        event_type,
        event_data: eventData,
        confidence: analysis.confidence,
        complete: false
      },
      auditId,
      photoUrl,
      complete: false,
      missingFields: ['quantity'],
      followUpQuestion,
      detectedItem,
      catalogMatch
    };

  } catch (error) {
    console.error('[photoEventParser] Error processing photo:', error);
    return {
      success: false,
      error: error.message || 'Failed to process photo'
    };
  }
}

/**
 * Process nutrition label photo and add product to catalog
 *
 * @param {string} labelPhotoUri - Local URI of nutrition label photo
 * @param {Object} detectedItem - Item detected from front photo {name, brand, form, event_type}
 * @param {string} frontPhotoUrl - URL of front photo (already uploaded)
 * @param {string} auditId - Audit record ID from initial photo
 * @param {string} userId - User ID
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<{success: boolean, catalogProduct?: Object, error?: string, needsRetake?: boolean}>}
 */
export async function processNutritionLabelPhoto(
  labelPhotoUri,
  detectedItem,
  frontPhotoUrl,
  auditId,
  userId,
  apiKey
) {
  try {
    console.log('[photoEventParser] Processing nutrition label photo...');

    // Import nutrition label extractor
    const { extractNutritionLabel } = require('./nutritionLabelExtractor');

    // Step 1: Extract nutrition data from label
    const extractionResult = await extractNutritionLabel(labelPhotoUri, apiKey);

    if (!extractionResult.success) {
      console.error('[photoEventParser] Failed to extract nutrition label:', extractionResult.error);
      return {
        success: false,
        error: extractionResult.error,
        needsRetake: extractionResult.needsRetake || false
      };
    }

    console.log('[photoEventParser] ✓ Nutrition label extracted:', extractionResult.data);

    // Step 2: Upload label photo to Supabase Storage
    const { url: labelPhotoUrl, error: uploadError } = await uploadPhotoToSupabase(labelPhotoUri, userId);

    if (uploadError) {
      console.error('[photoEventParser] Failed to upload label photo:', uploadError);
      return {
        success: false,
        error: `Failed to upload label photo: ${uploadError}`
      };
    }

    // Step 3: Build product data for catalog
    const productData = {
      product_name: detectedItem.name,
      brand: detectedItem.brand || null,
      product_type: detectedItem.event_type, // 'supplement', 'medication', 'food'
      serving_quantity: extractionResult.data.serving_quantity,
      serving_unit: extractionResult.data.serving_unit,
      serving_weight_grams: extractionResult.data.serving_weight_grams || null,
      micros: extractionResult.data.micros || {},
      active_ingredients: extractionResult.data.active_ingredients || [],
      barcode: extractionResult.data.barcode || null,
      photo_front_url: frontPhotoUrl,
      photo_label_url: labelPhotoUrl
    };

    // Step 4: Return extracted data for user confirmation (don't insert yet)
    return {
      success: true,
      extractedData: productData,
      labelPhotoUrl
    };

  } catch (error) {
    console.error('[photoEventParser] Error processing nutrition label:', error);
    return {
      success: false,
      error: error.message || 'Failed to process nutrition label'
    };
  }
}

/**
 * Confirm and add product to catalog after user review
 *
 * @param {Object} productData - Confirmed product data
 * @param {string} auditId - Audit record ID
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, catalogProduct?: Object, error?: string}>}
 */
export async function confirmAndAddToCatalog(productData, auditId, userId) {
  try {
    console.log('[photoEventParser] Adding product to catalog:', productData.product_name);

    // Add to catalog
    const result = await addProductToCatalog(productData, userId);

    if (!result.success) {
      return {
        success: false,
        error: result.error
      };
    }

    console.log('[photoEventParser] ✓ Product added to catalog:', result.product.id);

    // Update audit record with catalog link
    await updateAuditStatus(auditId, 'catalog_product_created', {
      product_catalog_id: result.product.id,
      product_name: result.product.product_name
    });

    return {
      success: true,
      catalogProduct: result.product
    };

  } catch (error) {
    console.error('[photoEventParser] Error adding to catalog:', error);
    return {
      success: false,
      error: error.message || 'Failed to add product to catalog'
    };
  }
}

/**
 * Handle user's quantity response from follow-up question
 *
 * @param {string} auditId - Audit record ID
 * @param {string} quantityResponse - User's answer (e.g., "2", "1 capsule", "3 pills")
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, event: Object, complete: boolean}>}
 */
export async function handleFollowUpResponse(auditId, quantityResponse, userId) {
  try {
    console.log('[photoEventParser] Processing quantity response:', quantityResponse);

    // Parse quantity from user input
    const quantity = parseQuantity(quantityResponse);

    if (!quantity || quantity <= 0) {
      return {
        success: false,
        error: 'Could not parse quantity from response'
      };
    }

    console.log('[photoEventParser] Parsed quantity:', quantity);

    // Fetch audit record to get original detection data
    const { data: auditRecord, error: fetchError } = await supabase
      .from('voice_records_audit')
      .select('*')
      .eq('id', auditId)
      .single();

    if (fetchError || !auditRecord) {
      return {
        success: false,
        error: 'Could not find original audit record'
      };
    }

    const metadata = auditRecord.nlp_metadata || {};
    const detectedItems = metadata.detected_items || [];
    const detectedItem = detectedItems[0]; // First item
    const catalogMatch = metadata.catalog_match;

    if (!detectedItem) {
      return {
        success: false,
        error: 'Missing detected item data in audit record'
      };
    }

    // Fetch catalog product if we have a match
    let catalogProduct = null;

    if (catalogMatch && catalogMatch.product_id) {
      const { data } = await supabase
        .from('product_catalog')
        .select('*')
        .eq('id', catalogMatch.product_id)
        .single();

      catalogProduct = data;
    }

    // Build event data using new format with calculated nutrients
    const eventData = buildSupplementEventData(
      catalogProduct,
      quantity,
      false, // not manual override
      null,  // no user-edited nutrients
      detectedItem // fallback detected info
    );

    console.log('[photoEventParser] Complete event data:', eventData);

    // Create voice_events entry
    const eventRecord = await createVoiceEvent(
      userId,
      detectedItem.event_type,
      eventData,
      new Date().toISOString(), // eventTime
      auditId,                   // sourceRecordId
      'photo'                    // captureMethod
    );

    // Update audit status
    await updateAuditStatus(auditId, 'awaiting_user_clarification_success', {
      quantity_response: quantityResponse,
      parsed_quantity: quantity,
      final_event_data: eventData
    });

    return {
      success: true,
      event: eventRecord,
      complete: true
    };

  } catch (error) {
    console.error('[photoEventParser] Error handling quantity response:', error);
    return {
      success: false,
      error: error.message || 'Failed to process quantity response'
    };
  }
}

/**
 * Build event data from detected item
 */
function buildEventDataFromDetection(detectedItem, productCatalogId, servingSize, nutrients) {
  const { name, brand, event_type } = detectedItem;

  const baseData = {
    name,
    brand: brand || null,
    product_catalog_id: productCatalogId
  };

  if (event_type === 'supplement' || event_type === 'medication') {
    return {
      ...baseData,
      dosage: null,  // Will be filled after quantity question
      units: null
    };
  }

  if (event_type === 'food') {
    return {
      description: brand ? `${brand} ${name}` : name,
      product_catalog_id: productCatalogId,
      calories: nutrients?.calories || null,
      carbs: nutrients?.carbohydrates || null,
      protein: nutrients?.protein || null,
      fat: nutrients?.fat || null,
      serving_size: servingSize ? formatServingSize(servingSize) : null
    };
  }

  return baseData;
}

/**
 * Generate natural language question for quantity
 */
function generateQuantityQuestion(productName, form) {
  return `How many ${form} of ${productName} did you take?`;
}

/**
 * Parse quantity from user response
 * Handles: "2", "two", "2 capsules", "three pills", etc.
 */
function parseQuantity(response) {
  if (!response) return null;

  const cleaned = response.trim().toLowerCase();

  // Try direct number parse
  const directNumber = parseInt(cleaned);
  if (!isNaN(directNumber) && directNumber > 0) {
    return directNumber;
  }

  // Extract first number from text (e.g., "2 capsules" → 2)
  const match = cleaned.match(/(\d+)/);
  if (match) {
    return parseInt(match[1]);
  }

  // Handle text numbers (one, two, three, etc.)
  const textNumbers = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };

  for (const [word, num] of Object.entries(textNumbers)) {
    if (cleaned.includes(word)) {
      return num;
    }
  }

  return null;
}

/**
 * Format serving size object to string
 */
function formatServingSize(servingSize) {
  if (!servingSize) return null;

  const { quantity, unit } = servingSize;

  if (quantity && unit) {
    return `${quantity} ${unit}${quantity > 1 ? 's' : ''}`;
  }

  return null;
}

/**
 * Build event data for supplement/medication/food with calculated nutrients
 *
 * @param {Object} catalogProduct - Product from product_catalog (or null if no match)
 * @param {number} amountConsumed - Number of units consumed
 * @param {boolean} isManualOverride - Whether user edited calculated values
 * @param {Object} userEditedNutrients - User-edited nutrients (if isManualOverride)
 * @param {Object} detectedInfo - Detected info from Gemini (used if no catalog match)
 * @returns {Object} Event data for voice_events.event_data
 */
export function buildSupplementEventData(
  catalogProduct,
  amountConsumed,
  isManualOverride = false,
  userEditedNutrients = null,
  detectedInfo = null
) {
  // No catalog match - use legacy format
  if (!catalogProduct) {
    return {
      product_catalog_id: null,
      name: detectedInfo?.name || 'Unknown',
      brand: detectedInfo?.brand || null,
      dosage: amountConsumed.toString(),
      units: detectedInfo?.form || 'capsule'
    };
  }

  // Calculate nutrients based on amount consumed
  const calculatedNutrients = isManualOverride && userEditedNutrients
    ? userEditedNutrients
    : calculateConsumedNutrients(catalogProduct, amountConsumed);

  return {
    product_catalog_id: catalogProduct.id,
    name: catalogProduct.product_name,
    brand: catalogProduct.brand,
    amount_consumed: amountConsumed,
    unit: catalogProduct.serving_unit,
    calculated_nutrients: calculatedNutrients,
    is_manual_override: isManualOverride
  };
}
