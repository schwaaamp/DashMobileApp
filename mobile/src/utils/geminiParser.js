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
      ? `\n\nUSER'S FREQUENTLY LOGGED ITEMS (use these for better accuracy):\n${frequentItems.map(({ item, count }) => `- "${item}" (logged ${count}x)`).join('\n')}\n\nIMPORTANT: When parsing input, check if it matches any of the user's frequent items. For example:\n- "element lemonade" likely means "LMNT lemonade" if that's in their history\n- "chicken thigh" likely refers to their usual preparation if they log it often\n- Brand names and specific products should match their historical entries`
      : '';

    const systemPrompt = `You are a health event parser. Listen to the user's audio recording and extract structured health event data.

CRITICAL: First transcribe the audio, then parse the transcription into structured data.

Return a JSON object with these fields:
- transcription: the text transcription of what the user said
- event_type: one of [food, glucose, insulin, activity, supplement, sauna, medication, symptom]
- event_data: object containing extracted fields based on event type
- event_time: ISO 8601 timestamp (use current time if not specified)
- confidence: number 0-100 indicating how confident you are in the parsing (100=certain, 50=moderate, 0=guessing)

Event type schemas:
${JSON.stringify(EVENT_TYPES, null, 2)}
${userContextSection}

Rules:
1. Always transcribe exactly what you hear first
2. Identify the most appropriate event_type from the transcription
3. Extract all available information
4. Use reasonable defaults for units (mg/dL for glucose, units for insulin, etc.)
5. For food, try to extract nutritional info if mentioned
6. For timestamps, interpret relative times ("30 min jog" = started 30 min ago)
7. CRITICAL: Match input against user's frequent items for better accuracy (e.g., "element" → "LMNT")

Example output format:
{
  "transcription": "Log 6 units of basal insulin",
  "event_type": "insulin",
  "event_data": {
    "value": 6,
    "units": "units",
    "insulin_type": "basal"
  },
  "event_time": "2024-01-01T12:00:00Z",
  "confidence": 95
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
        maxOutputTokens: 1024,
        responseMimeType: "application/json"
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
    const parsed = JSON.parse(content);

    // Validate the response has required fields
    if (!parsed.event_type || !parsed.event_data) {
      throw new Error('Invalid response from Gemini - missing required fields');
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
