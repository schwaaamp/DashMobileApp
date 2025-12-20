import * as FileSystem from 'expo-file-system/legacy';

// Event type schemas for validation
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
        value: { type: "NUMBER", nullable: true },
        duration: { type: "STRING", nullable: true },
        intensity: { type: "STRING", nullable: true },
        temperature: { type: "STRING", nullable: true },
        route: { type: "STRING", nullable: true },
        severity: { type: "STRING", nullable: true }
      }
    },
    time_info: {
      type: "OBJECT",
      nullable: true,
      properties: {
        relative_minutes_ago: {
          type: "NUMBER",
          nullable: true
        },
        specific_time: {
          type: "STRING",
          nullable: true
        },
        specific_date: {
          type: "STRING",
          nullable: true
        }
      }
    },
    confidence: {
      type: "NUMBER",
      description: "Confidence score from 0-100"
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
        value: { type: "NUMBER", nullable: true },
        duration: { type: "STRING", nullable: true },
        intensity: { type: "STRING", nullable: true },
        temperature: { type: "STRING", nullable: true },
        route: { type: "STRING", nullable: true },
        severity: { type: "STRING", nullable: true }
      }
    },
    time_info: {
      type: "OBJECT",
      nullable: true,
      properties: {
        relative_minutes_ago: {
          type: "NUMBER",
          nullable: true
        },
        specific_time: {
          type: "STRING",
          nullable: true
        },
        specific_date: {
          type: "STRING",
          nullable: true
        }
      }
    },
    confidence: {
      type: "NUMBER",
      description: "Confidence score from 0-100"
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

    // Extract frequently logged items for context
    const frequentItems = extractFrequentItems(userHistory);
    const userContextSection = frequentItems.length > 0
      ? `\n\nUSER'S FREQUENTLY LOGGED ITEMS (use these for better accuracy):\n${frequentItems.map(({ item, count }) => `- "${item}" (logged ${count}x)`).join('\n')}\n\nIMPORTANT: When parsing input, check if it matches any of the user's frequent items. For example:\n- "element" likely refers to the "LMNT" brand if that's in their history\n- "chicken thigh" likely refers to their usual preparation if they log it often\n- Pay attention to flavor/variant keywords (citrus, lemonade, chocolate, vanilla, etc.) and match them accurately\n- Brand names and specific products should match their historical entries`
      : '';

    const systemPrompt = `You are an AI assistant for a health tracking and wellness app. Users log various health events throughout their day to monitor their health, manage conditions like diabetes, and track wellness activities.

CONTEXT: This app helps users track:
- Food intake with nutritional information
- Blood glucose readings
- Insulin doses
- Physical activities and exercise
- Supplements and medications
- Wellness activities (sauna, cold plunge, etc.)
- Symptoms they're experiencing

Users speak naturally and you need to transcribe and parse their input into structured data.

CRITICAL: First transcribe the audio accurately, then parse the transcription into structured data.

Return a JSON object with these fields:
- transcription: the exact text transcription of what the user said
- event_type: one of [food, glucose, insulin, activity, supplement, sauna, medication, symptom]
- event_data: object containing extracted fields based on event type
- time_info: object with optional fields: { relative_minutes_ago: number, specific_time: "HH:MM", specific_date: "YYYY-MM-DD" } or null if referring to "now"
- confidence: number 0-100 indicating how confident you are in the parsing (100=certain, 50=moderate, 0=guessing)

Event type schemas:
${JSON.stringify(EVENT_TYPES, null, 2)}
${userContextSection}

Rules:
1. Always transcribe exactly what you hear first
2. Identify the most appropriate event_type from the transcription
3. Extract all available information
4. Use reasonable defaults for units (mg/dL for glucose, units for insulin, minutes for duration, etc.)
5. For food, try to extract nutritional info if mentioned
6. For time ranges (e.g., "2:42pm to 3:05pm"), calculate the duration in minutes and set time_info to the START time
7. For relative times ("30 min jog"), set relative_minutes_ago to indicate when it started
8. For specific times (e.g., "I ate lunch at noon"), set specific_time to that time
9. If no time is mentioned, set time_info to null (meaning "now")
10. CRITICAL: Match input against user's frequent items for better accuracy (e.g., "element" → "LMNT")
11. Temperature: default to Fahrenheit unless Celsius is explicitly mentioned

Example outputs:

Input: "Log 6 units of basal insulin"
Output: {
  "transcription": "Log 6 units of basal insulin",
  "event_type": "insulin",
  "event_data": {
    "value": 6,
    "units": "units",
    "insulin_type": "basal"
  },
  "time_info": null,
  "confidence": 95
}

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
        responseSchema: GEMINI_RESPONSE_SCHEMA
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${apiKey}`,
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

    // Extract frequently logged items
    const frequentItems = extractFrequentItems(userHistory);
    const userContextSection = frequentItems.length > 0
      ? `\n\nUSER'S FREQUENTLY LOGGED ITEMS (use these for better accuracy):\n${frequentItems.map(({ item, count }) => `- "${item}" (logged ${count}x)`).join('\n')}\n\nIMPORTANT: When parsing input, check if it matches any of the user's frequent items. For example:\n- "element" likely refers to the "LMNT" brand if that's in their history\n- "chicken thigh" likely refers to their usual preparation if they log it often\n- Pay attention to flavor/variant keywords (citrus, lemonade, chocolate, vanilla, etc.) and match them accurately\n- Brand names and specific products should match their historical entries`
      : '';

    const systemPrompt = buildSystemPrompt(userContextSection);

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
        responseSchema: TEXT_RESPONSE_SCHEMA
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${apiKey}`,
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
 * Build system prompt for Gemini
 */
function buildSystemPrompt(userContextSection) {
  return `You are an AI assistant for a health tracking and wellness app. Users log various health events throughout their day to monitor their health, manage conditions like diabetes, and track wellness activities.

CONTEXT: This app helps users track:
- Food intake with nutritional information
- Blood glucose readings
- Insulin doses
- Physical activities and exercise
- Supplements and medications
- Wellness activities (sauna, cold plunge, etc.)
- Symptoms they're experiencing

Users speak naturally and you need to parse their input into structured data.

Return a JSON object with these fields:
- event_type: one of [food, glucose, insulin, activity, supplement, sauna, medication, symptom]
- event_data: object containing extracted fields based on event type
- time_info: object with optional fields: { relative_minutes_ago: number, specific_time: "HH:MM", specific_date: "YYYY-MM-DD" } or null if referring to "now"
- confidence: number 0-100 indicating how confident you are in the parsing (100=certain, 50=moderate, 0=guessing)

Event type schemas:
${JSON.stringify(EVENT_TYPES, null, 2)}
${userContextSection}

Rules:
1. Identify the most appropriate event_type from the input
2. Extract all available information
3. Use reasonable defaults for units (mg/dL for glucose, units for insulin, minutes for duration, etc.)
4. For food, try to extract nutritional info if mentioned
5. For time ranges (e.g., "2:42pm to 3:05pm"), calculate the duration in minutes and set time_info to the START time
6. For relative times ("30 min jog"), set relative_minutes_ago to indicate when it started
7. For specific times (e.g., "I ate lunch at noon"), set specific_time to that time
8. If no time is mentioned, set time_info to null (meaning "now")
9. CRITICAL: Match input against user's frequent items for better accuracy (e.g., "element" → "LMNT")
10. Temperature: default to Fahrenheit unless Celsius is explicitly mentioned

Example outputs:

Input: "Log 6 units of basal insulin"
Output: {
  "event_type": "insulin",
  "event_data": {
    "value": 6,
    "units": "units",
    "insulin_type": "basal"
  },
  "time_info": null,
  "confidence": 95
}

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
}

Input: "30 minute jog"
Output: {
  "event_type": "activity",
  "event_data": {
    "activity_type": "jog",
    "duration": 30
  },
  "time_info": { "relative_minutes_ago": 30 },
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
