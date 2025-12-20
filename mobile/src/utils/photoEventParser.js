/**
 * Photo Event Parser
 * Handles end-to-end processing of photo-based supplement logging
 * Includes database lookup for serving sizes and multi-item support
 */

import { analyzeSupplementPhoto, uploadPhotoToSupabase, generateFollowUpQuestion } from './photoAnalysis';
import { searchAllProducts } from './productSearch';
import { createAuditRecord, updateAuditStatus, createVoiceEvent } from './voiceEventParser';
import { supabase } from './supabaseClient';

/**
 * Look up product serving size from Open Food Facts / USDA databases
 * @param {string} productName - Product name
 * @param {string} brand - Brand name
 * @param {string} usdaApiKey - USDA API key
 * @returns {Promise<Object|null>} Serving size info or null if not found
 */
async function lookupProductServingSize(productName, brand, usdaApiKey) {
  try {
    // Search with brand + product name for best match
    const searchQuery = `${brand} ${productName}`;
    console.log(`Looking up serving size for: "${searchQuery}"`);

    const products = await searchAllProducts(searchQuery, usdaApiKey);

    if (!products || products.length === 0) {
      console.log('No products found in database');
      return null;
    }

    // Take the highest confidence match
    const bestMatch = products[0];

    if (bestMatch.confidence < 60) {
      console.log(`Low confidence match (${bestMatch.confidence}%), skipping`);
      return null;
    }

    console.log(`Found match: ${bestMatch.name} (confidence: ${bestMatch.confidence}%)`);

    return {
      productId: bestMatch.id,
      source: bestMatch.source,
      name: bestMatch.name,
      brand: bestMatch.brand,
      servingSize: bestMatch.servingSize,
      nutrients: bestMatch.nutrients,
      confidence: bestMatch.confidence
    };
  } catch (error) {
    console.error('Error looking up product serving size:', error);
    return null;
  }
}

/**
 * Calculate dosage from quantity taken and serving size info
 * @param {number} quantityTaken - Number of capsules/tablets taken
 * @param {string} servingSize - Serving size from database (e.g., "2 capsules")
 * @param {Object} nutrients - Nutrients object from database
 * @returns {Object} Calculated dosage info
 */
function calculateDosageFromQuantity(quantityTaken, servingSize, nutrients) {
  try {
    // Parse serving size to get number of capsules per serving
    const servingSizeMatch = servingSize?.match(/(\d+)\s*(capsule|tablet|softgel|gummies)/i);
    const capsulesPerServing = servingSizeMatch ? parseInt(servingSizeMatch[1]) : 1;

    console.log(`Capsules per serving: ${capsulesPerServing}`);
    console.log(`Quantity taken: ${quantityTaken}`);

    // Find the primary nutrient (usually the one with highest value)
    let primaryNutrient = null;
    let primaryValue = 0;
    let primaryUnit = 'mg';

    if (nutrients) {
      // Check common nutrients in order of likelihood
      const nutrientKeys = Object.keys(nutrients);
      for (const key of nutrientKeys) {
        const value = nutrients[key];
        if (value && value > primaryValue) {
          primaryValue = value;
          primaryNutrient = key;
        }
      }
    }

    if (!primaryValue) {
      console.log('No nutrient data available for dosage calculation');
      return {
        dosage: null,
        units: null,
        quantityTaken: `${quantityTaken} ${servingSizeMatch?.[2] || 'capsules'}`
      };
    }

    // Calculate actual dosage
    const actualDosage = (quantityTaken / capsulesPerServing) * primaryValue;

    console.log(`Calculated dosage: ${actualDosage}${primaryUnit} (${primaryNutrient})`);

    return {
      dosage: Math.round(actualDosage).toString(),
      units: primaryUnit,
      nutrient: primaryNutrient,
      quantityTaken: `${quantityTaken} ${servingSizeMatch?.[2] || 'capsules'}`
    };
  } catch (error) {
    console.error('Error calculating dosage:', error);
    return {
      dosage: null,
      units: null,
      quantityTaken: `${quantityTaken} capsules`
    };
  }
}

/**
 * Main processing function for photo-based supplement logging
 * Supports MULTIPLE supplements in one photo
 *
 * @param {string} photoPath - Local photo URI
 * @param {string} userId - User ID
 * @param {string} apiKey - Gemini API key
 * @param {string} captureMethod - Capture method (default: 'photo')
 * @returns {Promise<Object>} Processing result with items array
 */
export async function processPhotoInput(photoPath, userId, apiKey, captureMethod = 'photo') {
  try {
    console.log('Processing photo input...');

    // Step 1: Upload photo to Supabase Storage
    console.log('Uploading photo to Supabase Storage...');
    const { url: photoUrl, error: uploadError } = await uploadPhotoToSupabase(photoPath, userId);

    if (uploadError) {
      console.warn('Photo upload failed, continuing without URL:', uploadError);
    }

    // Step 2: Analyze photo with Gemini Vision
    console.log('Analyzing photo with Gemini Vision...');
    const analysis = await analyzeSupplementPhoto(photoPath, userId, apiKey);

    if (!analysis.success || analysis.items.length === 0) {
      throw new Error(analysis.error || 'No supplements detected in photo');
    }

    console.log(`Detected ${analysis.items.length} supplement(s)`);

    // Step 3: For each item, look up serving size in databases
    const itemsWithServingInfo = [];

    for (const item of analysis.items) {
      console.log(`Looking up serving info for: ${item.brand} ${item.name}`);

      const usdaApiKey = process.env.EXPO_PUBLIC_USDA_API_KEY;
      const servingInfo = await lookupProductServingSize(item.name, item.brand, usdaApiKey);

      // Generate follow-up question
      const followUpQuestion = generateFollowUpQuestion(item, servingInfo);

      itemsWithServingInfo.push({
        ...item,
        servingInfo,
        followUpQuestion,
        needsManualDosage: !servingInfo // Flag for items without database match
      });
    }

    // Step 4: Create audit record with ALL items in metadata
    console.log('Creating audit record...');
    const auditRecord = await createAuditRecord(
      userId,
      `Photo: ${analysis.items.length} supplement(s)`,
      analysis.items[0].event_type, // Use first item's type for record
      null, // value
      null, // units
      'gemini-1.5-flash',
      {
        capture_method: 'photo',
        photo_url: photoUrl,
        confidence: analysis.confidence,
        items_detected: analysis.items.length,
        detected_items: itemsWithServingInfo,
        gemini_model: 'gemini-1.5-flash'
      }
    );

    // Step 5: Return for confirmation screen
    // The confirmation screen will collect quantity for each item
    return {
      success: true,
      items: itemsWithServingInfo,
      auditId: auditRecord.id,
      photoUrl: photoUrl || null,
      complete: false // Always needs user input for quantity
    };
  } catch (error) {
    console.error('Error processing photo input:', error);
    return {
      success: false,
      error: error.message,
      items: []
    };
  }
}

/**
 * Handle user's response to follow-up question
 * Creates a voice_events entry for the supplement
 *
 * @param {string} auditId - Audit record ID
 * @param {number} itemIndex - Index of item in detected_items array
 * @param {string} response - User's answer (quantity taken)
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result with created event
 */
export async function handleFollowUpResponse(auditId, itemIndex, response, userId) {
  try {
    console.log(`Handling follow-up response for item ${itemIndex}: "${response}"`);

    // Step 1: Fetch original audit record
    const { data: auditRecord, error: auditError } = await supabase
      .from('voice_records_audit')
      .select('*')
      .eq('id', auditId)
      .single();

    if (auditError || !auditRecord) {
      throw new Error('Audit record not found');
    }

    // Step 2: Get the specific item from metadata
    const detectedItems = auditRecord.nlp_metadata?.detected_items || [];
    if (itemIndex >= detectedItems.length) {
      throw new Error('Invalid item index');
    }

    const item = detectedItems[itemIndex];

    // Step 3: Parse user's answer (should be a number)
    const quantityTaken = parseInt(response);
    if (isNaN(quantityTaken) || quantityTaken <= 0) {
      throw new Error('Invalid quantity - please enter a positive number');
    }

    // Step 4: Calculate dosage if we have serving info
    let eventData = {
      name: `${item.brand} ${item.name}`,
      brand: item.brand
    };

    if (item.servingInfo) {
      // Calculate dosage from serving size
      const dosageInfo = calculateDosageFromQuantity(
        quantityTaken,
        item.servingInfo.servingSize,
        item.servingInfo.nutrients
      );

      eventData = {
        ...eventData,
        dosage: dosageInfo.dosage,
        units: dosageInfo.units,
        quantity_taken: dosageInfo.quantityTaken,
        matched_product_id: item.servingInfo.productId
      };
    } else {
      // No serving info - just store quantity
      eventData = {
        ...eventData,
        quantity_taken: `${quantityTaken} ${item.form || 'capsules'}`,
        dosage: null,
        units: null
      };
    }

    // Step 5: Create voice_events entry
    console.log('Creating voice_events entry...');
    const voiceEvent = await createVoiceEvent(
      userId,
      item.event_type,
      eventData,
      new Date().toISOString(),
      auditId,
      'photo'
    );

    // Step 6: Update audit status (only mark as success after ALL items are processed)
    // For now, we'll leave it as 'awaiting_user_clarification' until all items are done
    // The UI will handle marking it complete after the last item

    return {
      success: true,
      event: voiceEvent,
      complete: true
    };
  } catch (error) {
    console.error('Error handling follow-up response:', error);
    return {
      success: false,
      error: error.message,
      complete: false
    };
  }
}
