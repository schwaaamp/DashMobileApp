/**
 * Photo Analysis Utilities
 * Uses Gemini 2.5 Flash Vision API to detect multiple supplements from photos
 */

import * as FileSystem from 'expo-file-system';
import { supabase } from './supabaseClient';

// Event type schemas (same as geminiParser.js)
const EVENT_TYPES = {
  food: {
    required: ['description'],
    optional: ['calories', 'carbs', 'protein', 'fat', 'serving_size']
  },
  glucose: {
    required: ['value', 'units'],
    optional: ['context']
  },
  insulin: {
    required: ['value', 'units', 'insulin_type'],
    optional: ['site']
  },
  activity: {
    required: ['activity_type', 'duration'],
    optional: ['intensity', 'distance', 'calories_burned']
  },
  supplement: {
    required: ['name', 'dosage'],
    optional: ['units']
  },
  sauna: {
    required: ['duration', 'temperature'],
    optional: ['temperature_units']
  },
  medication: {
    required: ['name', 'dosage'],
    optional: ['units', 'route']
  },
  symptom: {
    required: ['description'],
    optional: ['severity', 'duration']
  }
};

/**
 * System prompt for multi-supplement detection
 */
const PHOTO_ANALYSIS_PROMPT = `You are analyzing a photo that may contain one or more supplement/medication bottles or packages.

IMPORTANT: Detect ALL visible supplement products in the photo, not just one.

For each product visible, extract:
- Product name (REQUIRED)
- Brand name (REQUIRED)
- Form factor (capsules, tablets, softgels, gummies, powder, liquid)

Return JSON with:
{
  "items": [
    {
      "name": "string",
      "brand": "string",
      "form": "string",
      "event_type": "string"
    }
  ],
  "confidence": 85
}

Event type schemas:
${JSON.stringify(EVENT_TYPES, null, 2)}

Rules:
1. If multiple bottles/packages are visible, return ALL of them in the items array
2. Focus on clearly visible product names and brands
3. Don't try to read serving sizes or dosages - we'll look those up in databases
4. If a product is partially obscured or unclear, still include it but note lower confidence
5. Distinguish between different products (don't merge multiple items into one)
6. event_type should be one of: supplement, medication, food

Example: Photo shows 3 supplement bottles
{
  "items": [
    { "name": "Vitamin D3", "brand": "NOW", "form": "softgels", "event_type": "supplement" },
    { "name": "Magnesium L-Threonate", "brand": "NOW", "form": "capsules", "event_type": "supplement" },
    { "name": "Omega-3", "brand": "Nordic Naturals", "form": "softgels", "event_type": "supplement" }
  ],
  "confidence": 90
}`;

/**
 * Convert image URI to base64 for Gemini API
 * @param {string} photoUri - Local photo URI from expo-image-picker
 * @returns {Promise<string>} Base64 encoded image
 */
export async function imageToBase64(photoUri) {
  try {
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw new Error('Failed to read image file');
  }
}

/**
 * Upload photo to Supabase Storage
 * @param {string} photoUri - Local photo URI
 * @param {string} userId - User ID for path organization
 * @returns {Promise<{url: string, error: null} | {url: null, error: string}>}
 */
export async function uploadPhotoToSupabase(photoUri, userId) {
  try {
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = photoUri.split('.').pop() || 'jpg';
    const fileName = `${timestamp}_supplement.${fileExtension}`;
    const filePath = `${userId}/${fileName}`;

    // Read file as base64
    const base64 = await imageToBase64(photoUri);

    // Convert base64 to blob
    const response = await fetch(`data:image/${fileExtension};base64,${base64}`);
    const blob = await response.blob();

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('user-photos')
      .upload(filePath, blob, {
        contentType: `image/${fileExtension}`,
        upsert: false
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      return { url: null, error: error.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('user-photos')
      .getPublicUrl(filePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('Error uploading photo:', error);
    return { url: null, error: error.message };
  }
}

/**
 * Analyze supplement photo using Gemini Vision API
 * Detects multiple supplements in a single photo
 *
 * @param {string} photoUri - Local photo URI
 * @param {string} userId - User ID (not used currently, but available for context)
 * @param {string} geminiApiKey - Gemini API key
 * @returns {Promise<{success: boolean, items: Array, confidence: number}>}
 */
export async function analyzeSupplementPhoto(photoUri, userId, geminiApiKey) {
  try {
    console.log('Analyzing photo with Gemini Vision API...');

    // Convert image to base64
    const base64Image = await imageToBase64(photoUri);

    // Detect MIME type from file extension
    const fileExtension = photoUri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = fileExtension === 'png' ? 'image/png' : 'image/jpeg';

    // Prepare Gemini API request
    const requestBody = {
      contents: [{
        parts: [
          { text: PHOTO_ANALYSIS_PROMPT },
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
        maxOutputTokens: 1024,
        responseMimeType: "application/json"
      }
    };

    // Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`;

    console.log('Calling Gemini Vision API...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Gemini Vision API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error response:', errorText);
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Parse response
    const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      throw new Error('No content in Gemini response');
    }

    // Parse JSON response
    const parsed = JSON.parse(textContent);

    // Validate response structure
    if (!parsed.items || !Array.isArray(parsed.items)) {
      throw new Error('Invalid response structure from Gemini - missing items array');
    }

    // Validate each item has required fields
    for (const item of parsed.items) {
      if (!item.name || !item.brand) {
        throw new Error('Invalid item structure - missing name or brand');
      }
      // Default event_type to supplement if not specified
      if (!item.event_type) {
        item.event_type = 'supplement';
      }
    }

    console.log(`Detected ${parsed.items.length} supplement(s) in photo`);

    return {
      success: true,
      items: parsed.items,
      confidence: parsed.confidence || 80
    };
  } catch (error) {
    console.error('Error analyzing photo:', error);
    return {
      success: false,
      items: [],
      confidence: 0,
      error: error.message
    };
  }
}

/**
 * Generate follow-up question for a specific item
 * @param {Object} item - Detected supplement item {name, brand, form}
 * @param {Object|null} servingInfo - Serving size info from database lookup
 * @returns {string} Natural language question
 */
export function generateFollowUpQuestion(item, servingInfo) {
  const formText = item.form || 'capsules';
  const productName = item.name;

  if (servingInfo && servingInfo.servingSize) {
    // We have serving size info from database
    return `How many ${formText} of ${productName} did you take?`;
  } else {
    // No database match - need more info
    return `How many ${formText} of ${productName} did you take, and what's the dosage per ${formText.slice(0, -1)}?`;
  }
}
