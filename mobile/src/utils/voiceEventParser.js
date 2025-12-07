import { supabase } from './supabaseClient';

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
 * Parse text input using Claude API
 * @param {string} text - The raw text input from user
 * @param {string} apiKey - Claude API key
 * @returns {Promise<{event_type: string, event_data: object, complete: boolean}>}
 */
export async function parseTextWithClaude(text, apiKey) {
  if (!apiKey) {
    throw new Error('Claude API key is required');
  }

  const systemPrompt = `You are a health event parser. Analyze the user's text and extract structured health event data.

Return a JSON object with these fields:
- event_type: one of [food, glucose, insulin, activity, supplement, sauna, medication, symptom]
- event_data: object containing extracted fields based on event type
- event_time: ISO 8601 timestamp (use current time if not specified)

Event type schemas:
${JSON.stringify(EVENT_TYPES, null, 2)}

Rules:
1. Always identify the most appropriate event_type
2. Extract all available information
3. Use reasonable defaults for units (mg/dL for glucose, units for insulin, etc.)
4. For food, try to extract nutritional info if mentioned
5. For timestamps, interpret relative times ("30 min jog" = started 30 min ago)

Example inputs and outputs:
Input: "Log 6 units of basal insulin"
Output: {"event_type": "insulin", "event_data": {"value": 6, "units": "units", "insulin_type": "basal"}, "event_time": "2024-01-01T12:00:00Z"}

Input: "Ate large chicken thigh with broccoli"
Output: {"event_type": "food", "event_data": {"description": "large chicken thigh with broccoli", "protein": 45, "carbs": 8}, "event_time": "2024-01-01T12:00:00Z"}`;

  try {
    const requestBody = {
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: text
        }
      ]
    };

    console.log('Calling Claude API with model:', requestBody.model);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Claude API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error response:', errorText);
      let error;
      try {
        error = JSON.parse(errorText);
      } catch (e) {
        throw new Error(`Claude API error (${response.status}): ${errorText}`);
      }
      throw new Error(`Claude API error: ${error.error?.message || error.message || JSON.stringify(error)}`);
    }

    const result = await response.json();
    const content = result.content[0].text;

    // Extract JSON from the response (Claude might wrap it in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from Claude response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate the response has required fields
    if (!parsed.event_type || !parsed.event_data) {
      throw new Error('Invalid response from Claude - missing required fields');
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
  } catch (error) {
    console.error('Error parsing with Claude:', error);
    throw error;
  }
}

/**
 * Insert audit record into voice_records_audit table
 */
export async function createAuditRecord(userId, rawText, eventType, value, units) {
  const { data, error } = await supabase
    .from('voice_records_audit')
    .insert({
      user_id: userId,
      raw_text: rawText,
      record_type: eventType || 'unknown',
      value: value || null,
      units: units || null,
      nlp_status: 'pending'
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating audit record:', error);
    throw new Error('Failed to create audit record');
  }

  return data;
}

/**
 * Update audit record status
 */
export async function updateAuditStatus(auditId, status) {
  const { error } = await supabase
    .from('voice_records_audit')
    .update({ nlp_status: status })
    .eq('id', auditId);

  if (error) {
    console.error('Error updating audit status:', error);
    throw new Error('Failed to update audit status');
  }
}

/**
 * Insert event into voice_events table
 */
export async function createVoiceEvent(userId, eventType, eventData, eventTime, sourceRecordId, captureMethod = 'manual') {
  const { data, error } = await supabase
    .from('voice_events')
    .insert({
      user_id: userId,
      event_type: eventType,
      event_data: eventData,
      event_time: eventTime || new Date().toISOString(),
      source_record_id: sourceRecordId,
      capture_method: captureMethod
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating voice event:', error);
    throw new Error('Failed to create voice event');
  }

  return data;
}

/**
 * Main function to parse text and save to database
 */
export async function processTextInput(text, userId, apiKey, captureMethod = 'manual') {
  try {
    // Step 1: Create audit record
    const auditRecord = await createAuditRecord(userId, text, null, null, null);

    try {
      // Step 2: Parse with Claude
      const parsed = await parseTextWithClaude(text, apiKey);

      // Step 3: Update audit record with parsed event type
      await supabase
        .from('voice_records_audit')
        .update({
          record_type: parsed.event_type,
          value: parsed.event_data.value || null,
          units: parsed.event_data.units || null
        })
        .eq('id', auditRecord.id);

      if (parsed.complete) {
        // Step 4a: If complete, save to voice_events
        const voiceEvent = await createVoiceEvent(
          userId,
          parsed.event_type,
          parsed.event_data,
          parsed.event_time,
          auditRecord.id,
          captureMethod
        );

        // Step 5a: Update audit status to 'parsed'
        await updateAuditStatus(auditRecord.id, 'parsed');

        return {
          success: true,
          complete: true,
          event: voiceEvent,
          auditId: auditRecord.id
        };
      } else {
        // Step 4b: If incomplete, return for user clarification
        await updateAuditStatus(auditRecord.id, 'awaiting_user_clarification');

        return {
          success: true,
          complete: false,
          parsed,
          auditId: auditRecord.id,
          missingFields: EVENT_TYPES[parsed.event_type].required.filter(
            field => !parsed.event_data[field]
          )
        };
      }
    } catch (parseError) {
      // Parsing failed
      await updateAuditStatus(auditRecord.id, 'error');
      throw parseError;
    }
  } catch (error) {
    console.error('Error processing text input:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
