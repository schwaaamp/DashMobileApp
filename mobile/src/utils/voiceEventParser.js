import { supabase } from './supabaseClient';
import { searchAllProducts, shouldSearchProducts } from './productSearch';
import { Logger } from './logger';

/**
 * Fetch user's recent events for context
 */
export async function getUserRecentEvents(userId, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('voice_events')
      .select('event_type, event_data, event_time')
      .eq('user_id', userId)
      .order('event_time', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching user history:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching user history:', error);
    return [];
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
 * @param {Array} userHistory - User's recent events for context
 * @returns {Promise<{event_type: string, event_data: object, complete: boolean}>}
 */
export async function parseTextWithClaude(text, apiKey, userHistory = [], userId = null) {
  if (!apiKey) {
    throw new Error('Claude API key is required');
  }

  // Extract frequently logged items
  const frequentItems = extractFrequentItems(userHistory);
  const userContextSection = frequentItems.length > 0
    ? `\n\nUSER'S FREQUENTLY LOGGED ITEMS (use these for better accuracy):\n${frequentItems.map(({ item, count }) => `- "${item}" (logged ${count}x)`).join('\n')}\n\nIMPORTANT: When parsing input, check if it matches any of the user's frequent items. For example:
- "element lemonade" likely means "LMNT lemonade" if that's in their history
- "chicken thigh" likely refers to their usual preparation if they log it often
- Brand names and specific products should match their historical entries`
    : '';

  const systemPrompt = `You are a health event parser. Analyze the user's text and extract structured health event data.

Return a JSON object with these fields:
- event_type: one of [food, glucose, insulin, activity, supplement, sauna, medication, symptom]
- event_data: object containing extracted fields based on event type
- event_time: ISO 8601 timestamp (use current time if not specified)
- confidence: number 0-100 indicating how confident you are in the parsing (100=certain, 50=moderate, 0=guessing)

Event type schemas:
${JSON.stringify(EVENT_TYPES, null, 2)}
${userContextSection}

Rules:
1. Always identify the most appropriate event_type
2. Extract all available information
3. Use reasonable defaults for units (mg/dL for glucose, units for insulin, etc.)
4. For food, try to extract nutritional info if mentioned
5. For timestamps, interpret relative times ("30 min jog" = started 30 min ago)
6. CRITICAL: Match input against user's frequent items for better accuracy (e.g., "element" → "LMNT")

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

    const startTime = Date.now();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });
    const duration = Date.now() - startTime;

    console.log('Claude API response status:', response.status);

    // Log API call
    await Logger.apiCall(
      'Claude',
      '/v1/messages',
      { model: requestBody.model, input_length: text.length },
      { status: response.status, ok: response.ok },
      duration,
      userId
    );

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

    // Log raw API response before parsing
    await Logger.info('parsing', 'Received Claude API response', {
      input_text: text,
      response_length: content.length,
      response_preview: content.substring(0, 500)
    }, userId);

    // Extract JSON from the response (Claude might wrap it in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await Logger.error('parsing', 'Failed to extract JSON from Claude response', {
        input_text: text,
        raw_response: content,
        response_length: content.length
      }, userId);
      throw new Error('Failed to extract JSON from Claude response');
    }

    // Log the extracted JSON string before parsing
    await Logger.debug('parsing', 'Extracted JSON from response', {
      extracted_json_preview: jsonMatch[0].substring(0, 500)
    }, userId);

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
      await Logger.parsingAttempt(text, parsed, null, userId);
    } catch (jsonError) {
      await Logger.parsingAttempt(text, null, jsonError, userId);
      await Logger.error('parsing', 'JSON parse error', {
        input_text: text,
        extracted_json: jsonMatch[0],
        error_message: jsonError.message,
        error_stack: jsonError.stack
      }, userId);
      throw jsonError;
    }

    // Validate the response has required fields
    if (!parsed.event_type || !parsed.event_data) {
      await Logger.error('parsing', 'Invalid Claude response - missing required fields', {
        input_text: text,
        parsed_object: parsed,
        has_event_type: !!parsed.event_type,
        has_event_data: !!parsed.event_data
      }, userId);
      throw new Error('Invalid response from Claude - missing required fields');
    }

    // Check if all required fields for the event type are present
    const schema = EVENT_TYPES[parsed.event_type];
    if (!schema) {
      await Logger.error('parsing', 'Unknown event type', {
        input_text: text,
        event_type: parsed.event_type,
        valid_types: Object.keys(EVENT_TYPES)
      }, userId);
      throw new Error(`Unknown event type: ${parsed.event_type}`);
    }

    const complete = schema.required.every(field =>
      parsed.event_data[field] !== undefined &&
      parsed.event_data[field] !== null &&
      parsed.event_data[field] !== ''
    );

    await Logger.info('parsing', 'Successfully parsed event', {
      input_text: text,
      event_type: parsed.event_type,
      complete,
      confidence: parsed.confidence,
      missing_fields: schema.required.filter(f => !parsed.event_data[f])
    }, userId);

    return {
      ...parsed,
      complete
    };
  } catch (error) {
    console.error('Error parsing with Claude:', error);
    await Logger.error('parsing', 'parseTextWithClaude failed', {
      input_text: text,
      error_message: error.message,
      error_stack: error.stack
    }, userId);
    throw error;
  }
}

/**
 * Insert audit record into voice_records_audit table
 */
export async function createAuditRecord(userId, rawText, eventType, value, units, nlpModel = null, nlpMetadata = null) {
  const { data, error } = await supabase
    .from('voice_records_audit')
    .insert({
      user_id: userId,
      raw_text: rawText,
      record_type: eventType || 'unknown',
      value: value || null,
      units: units || null,
      nlp_status: 'pending',
      nlp_model: nlpModel,
      nlp_metadata: nlpMetadata
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
export async function processTextInput(text, userId, apiKey, captureMethod = 'manual', transcriptionMetadata = null) {
  try {
    // Log the start of processing
    await Logger.info('voice_processing', 'Starting text input processing', {
      input_text: text,
      input_length: text.length,
      capture_method: captureMethod,
      has_transcription_metadata: !!transcriptionMetadata
    }, userId);

    // Step 1: Fetch user's recent events for context
    console.log('Fetching user history for context...');
    const userHistory = await getUserRecentEvents(userId, 50);
    console.log(`Found ${userHistory.length} recent events`);

    // Step 2: Create initial audit record
    const claudeModel = 'claude-3-opus-20240229';
    const initialMetadata = {
      capture_method: captureMethod,
      user_history_count: userHistory.length,
      claude_model: claudeModel
    };

    // Add transcription metadata if this was a voice input
    if (transcriptionMetadata) {
      initialMetadata.transcription = transcriptionMetadata;
    }

    const auditRecord = await createAuditRecord(userId, text, null, null, null, claudeModel, initialMetadata);

    try {
      // Step 3: Parse with Claude (with user history context)
      const parsed = await parseTextWithClaude(text, apiKey, userHistory, userId);
      const confidence = parsed.confidence || 50;

      console.log(`Parsing confidence: ${confidence}%`);

      // Step 4: Update audit record with parsed event type and metadata
      const updatedMetadata = {
        ...initialMetadata,
        confidence: confidence,
        parsed_at: new Date().toISOString()
      };

      await supabase
        .from('voice_records_audit')
        .update({
          record_type: parsed.event_type,
          value: parsed.event_data.value || null,
          units: parsed.event_data.units || null,
          nlp_metadata: updatedMetadata
        })
        .eq('id', auditRecord.id);

      // Step 5: Check if we should search for products
      let productOptions = null;
      const shouldSearch = shouldSearchProducts(parsed.event_type, parsed.event_data, confidence);
      console.log(`Product search decision: ${shouldSearch} (confidence: ${confidence}%, type: ${parsed.event_type})`);

      await Logger.info('voice_processing', 'Product search decision', {
        should_search: shouldSearch,
        event_type: parsed.event_type,
        confidence,
        input_text: text
      }, userId);

      if (shouldSearch) {
        console.log('Searching product databases...');
        const searchQuery = parsed.event_data.description || parsed.event_data.name || text;
        console.log(`Search query: "${searchQuery}"`);
        const usdaApiKey = process.env.EXPO_PUBLIC_USDA_API_KEY;
        productOptions = await searchAllProducts(searchQuery, usdaApiKey, userId);
        console.log(`Found ${productOptions.length} product options`);

        await Logger.info('voice_processing', 'Product search completed', {
          search_query: searchQuery,
          results_count: productOptions.length,
          top_results: productOptions.slice(0, 3).map(p => ({
            name: p.name,
            brand: p.brand,
            confidence: p.confidence
          }))
        }, userId);
      } else {
        console.log('Skipping product search - confidence is high enough');
      }

      // Determine if we should show confirmation screen
      const needsConfirmation = !parsed.complete ||
                                (shouldSearch && ['food', 'supplement', 'medication'].includes(parsed.event_type));

      if (parsed.complete && !needsConfirmation) {
        // Step 6a: If complete and doesn't need confirmation, save to voice_events
        console.log('Saving directly - complete and no confirmation needed');
        const voiceEvent = await createVoiceEvent(
          userId,
          parsed.event_type,
          parsed.event_data,
          parsed.event_time,
          auditRecord.id,
          captureMethod
        );

        // Step 7a: Update audit status to 'parsed'
        await updateAuditStatus(auditRecord.id, 'parsed');

        return {
          success: true,
          complete: true,
          event: voiceEvent,
          auditId: auditRecord.id
        };
      } else {
        // Step 6b: Show confirmation screen for incomplete entries or food/supplement/medication
        console.log(`Going to confirmation screen - complete: ${parsed.complete}, products: ${productOptions?.length || 0}, needs confirmation: ${needsConfirmation}`);
        await updateAuditStatus(auditRecord.id, 'awaiting_user_clarification');

        const missingFields = EVENT_TYPES[parsed.event_type]?.required.filter(
          field => !parsed.event_data[field]
        ) || [];

        return {
          success: true,
          complete: false,
          parsed,
          auditId: auditRecord.id,
          missingFields,
          productOptions, // Include product options for user to choose from (may be empty array)
          confidence,
        };
      }
    } catch (parseError) {
      // Parsing failed
      await Logger.error('voice_processing', 'Parsing failed in processTextInput', {
        input_text: text,
        error_message: parseError.message,
        error_stack: parseError.stack,
        audit_id: auditRecord.id
      }, userId);
      await updateAuditStatus(auditRecord.id, 'error');
      throw parseError;
    }
  } catch (error) {
    console.error('Error processing text input:', error);
    await Logger.error('voice_processing', 'processTextInput failed', {
      input_text: text,
      error_message: error.message,
      error_stack: error.stack,
      capture_method: captureMethod
    }, userId);
    return {
      success: false,
      error: error.message
    };
  }
}
