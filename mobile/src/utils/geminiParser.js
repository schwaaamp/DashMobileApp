import * as FileSystem from 'expo-file-system/legacy';

// Event type schemas for validation
const EVENT_TYPES = {
  food: {
    required: ['description'],
    optional: ['calories', 'carbs', 'protein', 'fat', 'serving_size', 'product_catalog_id']
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
    optional: ['units', 'product_catalog_id']
  },
  sauna: {
    required: ['duration', 'temperature'],
    optional: ['temperature_units']
  },
  medication: {
    required: ['name', 'dosage'],
    optional: ['units', 'route', 'active_ingredients', 'product_catalog_id']
  },
  symptom: {
    required: ['description'],
    optional: ['severity', 'duration']
  }
};

// Gemini API response schema to ensure valid JSON output
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcription: {
      type: "STRING",
      description: "Exact transcription of the user's audio input"
    },
    event_type: {
      type: "STRING",
      description: "Type of health event",
      enum: ["food", "glucose", "insulin", "activity", "supplement", "sauna", "medication", "symptom"]
    },
    event_data: {
      type: "OBJECT",
      description: "Event-specific data fields",
      properties: {
        description: { type: "STRING", nullable: true },
        name: { type: "STRING", nullable: true },
        brand: { type: "STRING", nullable: true },
        dosage: { type: "STRING", nullable: true },
        units: { type: "STRING", nullable: true },
        intensity: { type: "STRING", nullable: true },
        route: { type: "STRING", nullable: true },
        severity: { type: "STRING", nullable: true },
        activity_type: { type: "STRING", nullable: true },
        insulin_type: { type: "STRING", nullable: true },
        temperature_units: { type: "STRING", nullable: true },
        active_ingredients: {
          type: "ARRAY",
          nullable: true,
          description: "Array of active ingredients for medications",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "Ingredient name (INN preferred)" },
              strength: { type: "STRING", description: "Strength with units (e.g., '200mg')" }
            }
          }
        },
        product_catalog_id: {
          type: "STRING",
          nullable: true,
          description: "Optional UUID linking to product_catalog table (for food, supplement, medication)"
        },
        value: {
          type: "STRING",
          nullable: true,
          description: "Numeric value as string, max 2 decimal places (e.g., '10', '4.5', '125.75')"
        },
        duration: {
          type: "INTEGER",
          nullable: true,
          description: "Duration in whole minutes"
        },
        temperature: {
          type: "INTEGER",
          nullable: true,
          description: "Temperature in whole degrees"
        }
      }
    },
    time_info: {
      type: "OBJECT",
      nullable: true,
      properties: {
        relative_minutes_ago: {
          type: "INTEGER",
          nullable: true,
          description: "Whole minutes ago"
        },
        specific_time: {
          type: "STRING",
          nullable: true,
          description: "Time in HH:MM format"
        },
        specific_date: {
          type: "STRING",
          nullable: true,
          description: "Date in YYYY-MM-DD format"
        }
      }
    },
    confidence: {
      type: "INTEGER",
      description: "Confidence score 0-100"
    }
  },
  required: ["event_type", "event_data", "confidence"]
};

// Text-only response schema (no transcription field)
const TEXT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    event_type: {
      type: "STRING",
      description: "Type of health event",
      enum: ["food", "glucose", "insulin", "activity", "supplement", "sauna", "medication", "symptom"]
    },
    event_data: {
      type: "OBJECT",
      description: "Event-specific data fields",
      properties: {
        description: { type: "STRING", nullable: true },
        name: { type: "STRING", nullable: true },
        brand: { type: "STRING", nullable: true },
        dosage: { type: "STRING", nullable: true },
        units: { type: "STRING", nullable: true },
        intensity: { type: "STRING", nullable: true },
        route: { type: "STRING", nullable: true },
        severity: { type: "STRING", nullable: true },
        activity_type: { type: "STRING", nullable: true },
        insulin_type: { type: "STRING", nullable: true },
        temperature_units: { type: "STRING", nullable: true },
        active_ingredients: {
          type: "ARRAY",
          nullable: true,
          description: "Array of active ingredients for medications",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "Ingredient name (INN preferred)" },
              strength: { type: "STRING", description: "Strength with units (e.g., '200mg')" }
            }
          }
        },
        product_catalog_id: {
          type: "STRING",
          nullable: true,
          description: "Optional UUID linking to product_catalog table (for food, supplement, medication)"
        },
        value: {
          type: "STRING",
          nullable: true,
          description: "Numeric value as string, max 2 decimal places"
        },
        duration: { type: "INTEGER", nullable: true },
        temperature: { type: "INTEGER", nullable: true }
      }
    },
    time_info: {
      type: "OBJECT",
      nullable: true,
      properties: {
        relative_minutes_ago: { type: "INTEGER", nullable: true },
        specific_time: { type: "STRING", nullable: true },
        specific_date: { type: "STRING", nullable: true }
      }
    },
    confidence: {
      type: "INTEGER",
      description: "Confidence score 0-100"
    }
  },
  required: ["event_type", "event_data", "confidence"]
};

/**
 * Parse audio using Gemini API (transcription + parsing in one call)
 * @param {string} audioUri - The URI to the audio file
 * @param {string} apiKey - Gemini API key
 * @param {Array} userHistory - User's recent events for context
 * @returns {Promise<{event_type: string, event_data: object, complete: boolean, confidence: number}>}
 */
export async function parseAudioWithGemini(audioUri, apiKey, userHistory = []) {
  if (!apiKey) {
    throw new Error('Gemini API key is required');
  }

  try {
    console.log('Reading audio file for Gemini...');

    // Read audio file as base64
    const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Determine mime type from file extension
    const fileName = audioUri.split('/').pop() || 'recording.m4a';
    const mimeType = fileName.endsWith('.caf') ? 'audio/x-caf' :
                     fileName.endsWith('.m4a') ? 'audio/mp4' :
                     'audio/mpeg';

    console.log(`Audio file type: ${mimeType}`);

    const systemPrompt = `Health event transcription and parsing assistant. Transcribe audio verbatim, then extract structured data.

Event types: food, glucose, insulin, activity, supplement, sauna, medication, symptom

CRITICAL: Event Type Classification Rules:
- FOOD: Whole foods, prepared meals, snacks without health claims (apple, rice, chicken, pizza)
- SUPPLEMENT: Pills/capsules/powders marketed for health benefits (vitamins, minerals, protein powder, creatine, electrolytes like LMNT, probiotics, collagen)
- MEDICATION: Pharmaceuticals with active ingredients (Advil, Tylenol, Metformin, antibiotics, prescription drugs)

Ambiguous Cases:
- "Protein powder" → supplement (not food)
- "Fish oil" → supplement (not medication)
- "Vitamin D" → supplement (not medication)
- "Advil" / "Ibuprofen" → medication (not supplement)
- "Energy drink" → food (unless vitamin-fortified health drink)
- "Meal replacement shake" → food (if meal substitute) OR supplement (if protein powder)

Rules:
- Transcribe exactly what you hear first
- For time ranges (e.g., "2-2:30pm"), calculate duration and set specific_time to start
- For relative times (e.g., "30 min ago"), use relative_minutes_ago
- No time mentioned: set time_info to null
- Defaults: glucose in mg/dL, insulin in units, temperature in Fahrenheit
- Extract product names and brands accurately
- For medications: If brand name is known (e.g., "Advil", "Tylenol"), extract active ingredients using international non-proprietary names (INN) in active_ingredients array. For multi-ingredient drugs (e.g., NyQuil), list ALL active ingredients.

Example:
Input: "Sauna from 2:42pm to 3:05pm"
Output: {
  "transcription": "Sauna from 2:42pm to 3:05pm",
  "event_type": "sauna",
  "event_data": {
    "duration": 23,
    "temperature": 180,
    "temperature_units": "F"
  },
  "time_info": { "specific_time": "14:42" },
  "confidence": 90
}

Input: "30 minute jog"
Output: {
  "transcription": "30 minute jog",
  "event_type": "activity",
  "event_data": {
    "activity_type": "jog",
    "duration": 30
  },
  "time_info": { "relative_minutes_ago": 30 },
  "confidence": 90
}`;

    console.log('Calling Gemini API...');

    const requestBody = {
      contents: [{
        parts: [
          {
            text: systemPrompt
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Audio
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        thinkingConfig: {
          thinkingBudget: 0  // Disable thinking process to save tokens
        }
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    console.log('Gemini API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error response:', errorText);
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('Gemini API result:', JSON.stringify(result, null, 2));

    if (!result.candidates || result.candidates.length === 0) {
      throw new Error('No response from Gemini');
    }

    const content = result.candidates[0].content.parts[0].text;
    console.log('Gemini response text:', content);

    // Parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse Gemini JSON response:', e);
      console.error('Raw content:', content);
      throw new Error('Gemini returned invalid JSON');
    }

    // Validate the response has required fields
    if (!parsed || typeof parsed !== 'object') {
      console.error('Parsed response is not an object:', parsed);
      throw new Error('Invalid response from Gemini - not an object');
    }

    if (!parsed.event_type) {
      console.error('Missing event_type in response:', parsed);
      throw new Error('Invalid response from Gemini - missing event_type');
    }

    if (!parsed.event_data || typeof parsed.event_data !== 'object') {
      console.error('Missing or invalid event_data in response:', parsed);
      throw new Error('Invalid response from Gemini - missing or invalid event_data');
    }

    // Check if all required fields for the event type are present
    const schema = EVENT_TYPES[parsed.event_type];
    if (!schema) {
      throw new Error(`Unknown event type: ${parsed.event_type}`);
    }

    const complete = schema.required.every(field =>
      parsed.event_data[field] !== undefined &&
      parsed.event_data[field] !== null &&
      parsed.event_data[field] !== ''
    );

    return {
      ...parsed,
      complete,
      transcription: parsed.transcription || 'Unable to transcribe'
    };
  } catch (error) {
    console.error('Error parsing with Gemini:', error);
    throw error;
  }
}

/**
 * Parse text input using Gemini API (text parsing only, no audio)
 * @param {string} text - The text input from user
 * @param {string} apiKey - Gemini API key
 * @param {Array} userHistory - User's recent events for context
 * @returns {Promise<{event_type: string, event_data: object, complete: boolean, confidence: number}>}
 */
export async function parseTextWithGemini(text, apiKey, userHistory = []) {
  if (!apiKey) {
    throw new Error('Gemini API key is required');
  }

  try {
    console.log('Parsing text with Gemini...');

    const systemPrompt = buildSystemPrompt();

    const requestBody = {
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\nUser input: "${text}"`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: TEXT_RESPONSE_SCHEMA,
        thinkingConfig: {
          thinkingBudget: 0  // Disable thinking process to save tokens
        }
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    console.log('Gemini API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error response:', errorText);
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('Gemini API result:', JSON.stringify(result, null, 2));

    if (!result.candidates || result.candidates.length === 0) {
      throw new Error('No response from Gemini');
    }

    const content = result.candidates[0].content.parts[0].text;
    console.log('Gemini response text:', content);

    return parseAndValidateGeminiResponse(content);
  } catch (error) {
    console.error('Error parsing text with Gemini:', error);
    throw error;
  }
}

/**
 * Build system prompt for Gemini (optimized for minimal tokens)
 */
function buildSystemPrompt() {
  return `Health event parsing assistant. Extract structured data from user input.

Event types: food, glucose, insulin, activity, supplement, sauna, medication, symptom

CRITICAL: Event Type Classification Rules:
- FOOD: Whole foods, prepared meals, snacks without health claims (apple, rice, chicken, pizza)
- SUPPLEMENT: Pills/capsules/powders marketed for health benefits (vitamins, minerals, protein powder, creatine, electrolytes like LMNT, probiotics, collagen)
- MEDICATION: Pharmaceuticals with active ingredients (Advil, Tylenol, Metformin, antibiotics, prescription drugs)

Ambiguous Cases:
- "Protein powder" → supplement (not food)
- "Fish oil" → supplement (not medication)
- "Vitamin D" → supplement (not medication)
- "Advil" / "Ibuprofen" → medication (not supplement)
- "Energy drink" → food (unless vitamin-fortified health drink)
- "Meal replacement shake" → food (if meal substitute) OR supplement (if protein powder)

Rules:
- For time ranges (e.g., "2-2:30pm"), calculate duration and set specific_time to start
- For relative times (e.g., "30 min ago"), use relative_minutes_ago
- No time mentioned: set time_info to null
- Defaults: glucose in mg/dL, insulin in units, temperature in Fahrenheit
- Extract product names and brands accurately
- For medications: If brand name is known (e.g., "Advil", "Tylenol"), extract active ingredients using international non-proprietary names (INN) in active_ingredients array. For multi-ingredient drugs (e.g., NyQuil), list ALL active ingredients.

Example:
Input: "Sauna from 2:42pm to 3:05pm"
Output: {
  "event_type": "sauna",
  "event_data": {
    "duration": 23,
    "temperature": 180,
    "temperature_units": "F"
  },
  "time_info": { "specific_time": "14:42" },
  "confidence": 90
}`;
}

/**
 * Parse and validate Gemini JSON response
 */
function parseAndValidateGeminiResponse(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    console.error('Failed to parse Gemini JSON response:', e);
    console.error('Raw content:', content);
    throw new Error('Gemini returned invalid JSON');
  }

  // Validate the response has required fields
  if (!parsed || typeof parsed !== 'object') {
    console.error('Parsed response is not an object:', parsed);
    throw new Error('Invalid response from Gemini - not an object');
  }

  if (!parsed.event_type) {
    console.error('Missing event_type in response:', parsed);
    throw new Error('Invalid response from Gemini - missing event_type');
  }

  if (!parsed.event_data || typeof parsed.event_data !== 'object') {
    console.error('Missing or invalid event_data in response:', parsed);
    throw new Error('Invalid response from Gemini - missing or invalid event_data');
  }

  // Check if all required fields for the event type are present
  const schema = EVENT_TYPES[parsed.event_type];
  if (!schema) {
    throw new Error(`Unknown event type: ${parsed.event_type}`);
  }

  const complete = schema.required.every(field =>
    parsed.event_data[field] !== undefined &&
    parsed.event_data[field] !== null &&
    parsed.event_data[field] !== ''
  );

  return {
    ...parsed,
    complete
  };
}

/**
 * Extract frequently logged items from user history
 *
 * NOTE: This function is preserved for potential future analytics use but is NO LONGER
 * used in Gemini prompts. Product recognition is now handled by user_product_registry
 * with phonetic matching, which is more accurate and eliminates ~200 prompt tokens.
 *
 * @deprecated Use user_product_registry for product recognition instead
 */
function extractFrequentItems(history) {
  const itemCounts = {};

  history.forEach(event => {
    if (event.event_type === 'food' && event.event_data?.description) {
      const desc = event.event_data.description.toLowerCase();
      itemCounts[desc] = (itemCounts[desc] || 0) + 1;
    } else if (event.event_type === 'supplement' && event.event_data?.name) {
      const name = event.event_data.name.toLowerCase();
      itemCounts[name] = (itemCounts[name] || 0) + 1;
    } else if (event.event_type === 'medication' && event.event_data?.name) {
      const name = event.event_data.name.toLowerCase();
      itemCounts[name] = (itemCounts[name] || 0) + 1;
    }
  });

  // Sort by frequency and return top 20
  return Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([item, count]) => ({ item, count }));
}

/**
 * Calculate event_time from time_info object
 * @param {object|null} timeInfo - Time information from Gemini parsing
 * @returns {string} ISO 8601 timestamp
 */
export function calculateEventTime(timeInfo) {
  const now = new Date();

  // If no time info, use current time
  if (!timeInfo) {
    return now.toISOString();
  }

  // If relative time (e.g., "30 minutes ago")
  if (timeInfo.relative_minutes_ago !== undefined && timeInfo.relative_minutes_ago !== null) {
    const eventTime = new Date(now.getTime() - (timeInfo.relative_minutes_ago * 60000));
    return eventTime.toISOString();
  }

  // If specific time on today (e.g., "2:42pm")
  if (timeInfo.specific_time) {
    const [hours, minutes] = timeInfo.specific_time.split(':').map(Number);
    const eventTime = new Date(now);
    eventTime.setHours(hours, minutes, 0, 0);

    // If the time is in the future, assume it was yesterday
    if (eventTime > now) {
      eventTime.setDate(eventTime.getDate() - 1);
    }

    return eventTime.toISOString();
  }

  // If specific date
  if (timeInfo.specific_date) {
    const eventTime = new Date(timeInfo.specific_date);

    // If specific_time is also provided, use it
    if (timeInfo.specific_time) {
      const [hours, minutes] = timeInfo.specific_time.split(':').map(Number);
      eventTime.setHours(hours, minutes, 0, 0);
    }

    return eventTime.toISOString();
  }

  // Fallback to current time
  return now.toISOString();
}
