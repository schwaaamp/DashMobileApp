/**
 * Nutrition Label Extractor
 *
 * Uses Gemini Vision API to extract data from supplement/food nutrition labels.
 */

import * as FileSystem from 'expo-file-system/legacy';

const BARCODE_CONFIDENCE_THRESHOLD = 80;

/**
 * Extract nutrition information from a label photo using Gemini Vision
 *
 * @param {string} photoUri - Local photo URI
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<{success: boolean, data?: Object, error?: string, needsRetake?: boolean}>}
 */
export async function extractNutritionLabel(photoUri, apiKey) {
  try {
    // Read photo as base64
    const base64Image = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Determine MIME type
    const fileExtension = photoUri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = fileExtension === 'png' ? 'image/png' : 'image/jpeg';

    const prompt = `Extract nutrition/supplement facts from this label photo.

Analyze the label and return structured JSON with:

{
  "serving_quantity": number,        // e.g., 3 (for "3 capsules")
  "serving_unit": string,            // e.g., "capsule", "tablet", "scoop", "bar"
  "serving_weight_grams": number | null,  // Weight in grams if listed
  "micros": {
    "nutrient_name": { "amount": number, "unit": "mg" | "mcg" | "g" | "IU" | "kcal" }
  },
  "active_ingredients": [
    { "name": string, "atc_code": string | null, "strength": string | null }
  ],
  "barcode": string | null,          // If visible in image
  "barcode_confidence": 0-100        // Confidence in barcode reading
}

For supplements: Include all vitamins, minerals, and active compounds in micros.
For medications: Include active ingredients with strength (e.g., "200mg").
For foods: Include calories, protein, carbs, fat, fiber, sugar in micros.

If the label is unreadable or too blurry, return:
{ "error": "Unable to read nutrition label", "readable": false }

Return ONLY valid JSON, no explanation.`;

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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: `Gemini API error: ${response.status}`
      };
    }

    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      return {
        success: false,
        error: 'No response from Gemini Vision'
      };
    }

    // Parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return {
        success: false,
        error: `Failed to parse Gemini response: ${e.message}`
      };
    }

    // Check if label was unreadable
    if (parsed.error || parsed.readable === false) {
      return {
        success: false,
        error: parsed.error || 'Unable to read nutrition label',
        needsRetake: true
      };
    }

    // Validate required fields
    const validationError = validateNutritionData(parsed);
    if (validationError) {
      return {
        success: false,
        error: validationError
      };
    }

    // Filter barcode based on confidence threshold
    if (parsed.barcode && parsed.barcode_confidence < BARCODE_CONFIDENCE_THRESHOLD) {
      parsed.barcode = null;
    }

    return {
      success: true,
      data: parsed
    };

  } catch (error) {
    console.error('[extractNutritionLabel] Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to extract nutrition label'
    };
  }
}

/**
 * Validate extracted nutrition data has required fields
 *
 * @param {Object} data - Extracted nutrition data
 * @returns {string|null} Error message or null if valid
 */
function validateNutritionData(data) {
  if (!data.serving_quantity || typeof data.serving_quantity !== 'number') {
    return 'Missing required field: serving_quantity';
  }

  if (!data.serving_unit || typeof data.serving_unit !== 'string') {
    return 'Missing required field: serving_unit';
  }

  // Must have at least one nutrient or active ingredient
  const hasMicros = data.micros && Object.keys(data.micros).length > 0;
  const hasIngredients = data.active_ingredients && data.active_ingredients.length > 0;

  if (!hasMicros && !hasIngredients) {
    return 'Must have at least one nutrient or active ingredient';
  }

  return null;
}
