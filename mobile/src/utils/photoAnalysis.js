/**
 * Photo Analysis Utilities
 * Uses Gemini 2.5 Flash Vision API to detect multiple supplements from photos
 */

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabaseClient';
import { Buffer } from 'buffer';

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
    console.log('[uploadPhotoToSupabase] Starting upload:', { photoUri, userId });

    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = photoUri.split('.').pop() || 'jpg';
    const fileName = `${timestamp}_supplement.${fileExtension}`;
    const filePath = `${userId}/${fileName}`;

    console.log('[uploadPhotoToSupabase] File path:', filePath);

    // Read file as base64
    const base64 = await imageToBase64(photoUri);
    console.log('[uploadPhotoToSupabase] Base64 length:', base64.length);

    // Convert base64 to Uint8Array using Buffer (React Native compatible)
    const bytes = decodeBase64ToUint8Array(base64);
    console.log('[uploadPhotoToSupabase] Bytes length:', bytes.length);

    // Log upload parameters for debugging
    console.log('[uploadPhotoToSupabase] Upload parameters:', {
      bucket: 'user-photos',
      filePath,
      bytesType: bytes.constructor.name,
      contentType: `image/${fileExtension}`
    });

    // Convert base64 to ArrayBuffer for upload
    // Supabase accepts base64 strings directly, no need for blob conversion
    const { data, error } = await supabase.storage
      .from('user-photos')
      .upload(filePath, bytes, {
        contentType: `image/${fileExtension}`,
        upsert: false
      });

    console.log('[uploadPhotoToSupabase] Upload response:', { data, error });

    if (error) {
      console.error('[uploadPhotoToSupabase] Supabase upload error:', {
        message: error.message,
        statusCode: error.statusCode,
        error: error
      });
      return { url: null, error: error.message };
    }

    console.log('[uploadPhotoToSupabase] Upload successful:', data);

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('user-photos')
      .getPublicUrl(filePath);

    console.log('[uploadPhotoToSupabase] Public URL:', publicUrl);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('[uploadPhotoToSupabase] Exception caught:', {
      message: error.message,
      stack: error.stack,
      error: error
    });
    return { url: null, error: error.message };
  }
}

/**
 * Decode base64 string to Uint8Array for file upload
 * Uses Buffer (React Native compatible) instead of atob (Web API only)
 */
function decodeBase64ToUint8Array(base64) {
  try {
    // Buffer is available in React Native via polyfills
    if (typeof Buffer !== 'undefined') {
      const buffer = Buffer.from(base64, 'base64');
      return new Uint8Array(buffer);
    }

    // Fallback to atob for web/test environments
    if (typeof atob !== 'undefined') {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }

    throw new Error('No base64 decoding method available (Buffer or atob)');
  } catch (error) {
    console.error('[decodeBase64ToUint8Array] Error:', error);
    throw new Error(`Failed to decode base64: ${error.message}`);
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
    console.log('[analyzeSupplementPhoto] Starting analysis:', { photoUri, userId });

    // Convert image to base64
    const base64Image = await imageToBase64(photoUri);
    console.log('[analyzeSupplementPhoto] Base64 image length:', base64Image.length);

    // Detect MIME type from file extension
    const fileExtension = photoUri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = fileExtension === 'png' ? 'image/png' : 'image/jpeg';
    console.log('[analyzeSupplementPhoto] Detected MIME type:', mimeType);

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
    const visionModel = process.env.EXPO_PUBLIC_GEMINI_VISION_MODEL || 'gemini-2.0-flash-exp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${geminiApiKey}`;

    console.log('[analyzeSupplementPhoto] Calling Gemini Vision API...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[analyzeSupplementPhoto] Gemini Vision API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[analyzeSupplementPhoto] Gemini API error response:', errorText);
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('[analyzeSupplementPhoto] Gemini API response:', JSON.stringify(result, null, 2));

    // Parse response
    const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      console.error('[analyzeSupplementPhoto] No content in Gemini response');
      throw new Error('No content in Gemini response');
    }

    console.log('[analyzeSupplementPhoto] Text content from Gemini:', textContent);

    // Parse JSON response
    const parsed = JSON.parse(textContent);
    console.log('[analyzeSupplementPhoto] Parsed JSON:', JSON.stringify(parsed, null, 2));

    // Validate response structure
    if (!parsed.items || !Array.isArray(parsed.items)) {
      console.error('[analyzeSupplementPhoto] Invalid response structure - missing items array');
      throw new Error('Invalid response structure from Gemini - missing items array');
    }

    // Validate each item has required fields
    for (const item of parsed.items) {
      if (!item.name || !item.brand) {
        console.error('[analyzeSupplementPhoto] Invalid item structure:', item);
        throw new Error('Invalid item structure - missing name or brand');
      }
      // Default event_type to supplement if not specified
      if (!item.event_type) {
        item.event_type = 'supplement';
      }
    }

    console.log(`[analyzeSupplementPhoto] ✓ Detected ${parsed.items.length} supplement(s) in photo`);

    return {
      success: true,
      items: parsed.items,
      confidence: parsed.confidence || 80
    };
  } catch (error) {
    console.error('[analyzeSupplementPhoto] Error analyzing photo:', {
      message: error.message,
      stack: error.stack,
      error: error
    });
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
