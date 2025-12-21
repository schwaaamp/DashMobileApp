import { supabase } from './supabaseClient';
import { searchAllProducts, shouldSearchProducts } from './productSearch';
import { Logger } from './logger';
import { checkUserProductRegistry, fuzzyMatchUserProducts, updateUserProductRegistry } from './productRegistry';

/**
 * Fetch user's recent events for context
 */
export async function getUserRecentEvents(userId, limit = 50) {
  // Validate userId - return empty array if invalid (defensive programming)
  if (!userId || typeof userId !== 'string') {
    console.warn('getUserRecentEvents called with invalid userId:', userId);
    return [];
  }

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

/**
 * Reclassify food items that are actually supplements
 * This handles cases where Claude incorrectly classifies electrolyte drinks,
 * protein powders, and other supplements as food
 *
 * @param {string} description - The food description from Claude
 * @returns {object|null} - Supplement data if reclassified, null otherwise
 */
function reclassifyFoodToSupplement(description) {
  if (!description) return null;

  const lowerDesc = description.toLowerCase();

  // Known supplement brands (electrolyte drinks)
  const electrolyteBrands = [
    { pattern: /\blmnt\b/i, name: 'LMNT', defaultDosage: '1 pack', units: 'pack' },
    { pattern: /\belement\b/i, name: 'LMNT', defaultDosage: '1 pack', units: 'pack' },
    { pattern: /\bnuun\b/i, name: 'Nuun', defaultDosage: '1 tablet', units: 'tablet' },
    { pattern: /\bliquid iv\b/i, name: 'Liquid IV', defaultDosage: '1 packet', units: 'packet' },
    { pattern: /\bdrip drop\b/i, name: 'DripDrop', defaultDosage: '1 packet', units: 'packet' },
  ];

  // Check for electrolyte brands
  for (const brand of electrolyteBrands) {
    if (brand.pattern.test(lowerDesc)) {
      // Extract flavor if present
      const flavorMatch = lowerDesc.match(/(citrus|lemonade|orange|raspberry|watermelon|mango|chocolate|vanilla|strawberry)/i);
      const flavor = flavorMatch ? ` ${flavorMatch[1].charAt(0).toUpperCase()}${flavorMatch[1].slice(1)}` : '';

      return {
        name: `${brand.name}${flavor}`,
        dosage: brand.defaultDosage,
        units: brand.units
      };
    }
  }

  // Protein powder patterns
  if (/\bprotein\s+(powder|shake)\b/i.test(lowerDesc) || /\bwhey\b/i.test(lowerDesc)) {
    return {
      name: description,
      dosage: '1 scoop',
      units: 'scoop'
    };
  }

  // Creatine
  if (/\bcreatine\b/i.test(lowerDesc)) {
    return {
      name: 'Creatine',
      dosage: '5g',
      units: 'g'
    };
  }

  // Pre-workout supplements
  if (/\bpre-?workout\b/i.test(lowerDesc)) {
    return {
      name: description,
      dosage: '1 scoop',
      units: 'scoop'
    };
  }

  // Amino acids
  if (/\b(bcaa|amino acid|eaa)\b/i.test(lowerDesc)) {
    return {
      name: description,
      dosage: '1 scoop',
      units: 'scoop'
    };
  }

  return null;
}

/**
 * Score how likely a description is a supplement vs food
 * Returns 0-1 score (1 = definitely supplement)
 * Uses semantic patterns instead of hard-coded brands
 */
function scoreSupplementLikelihood(description) {
  if (!description) return 0;

  const lowerDesc = description.toLowerCase();

  const indicators = {
    // Supplement-specific keywords
    keywords: /\b(electrolyte|protein|vitamin|mineral|creatine|bcaa|amino|omega|probiotic|collagen|magnesium|calcium|zinc|iron|potassium|sodium)\b/i,

    // Dosage indicators (mg, IU, etc.)
    dosage: /\b\d+\s*(mg|mcg|iu|g|pack|scoop|tablets?|capsules?|softgels?|gumm(?:y|ies))\b/i,

    // Form factors typical of supplements (handle singular and plural)
    formFactor: /\b(powder|shake|drink\s*mix|capsules?|tablets?|softgels?|gumm(?:y|ies)|supplement)\b/i,

    // Supplement categories
    categories: /\b(pre-?workout|post-?workout|sports\s*nutrition|multivitamin|nootropic)\b/i
  };

  let score = 0;
  if (indicators.keywords.test(lowerDesc)) score += 0.5;
  if (indicators.dosage.test(lowerDesc)) score += 0.3;
  if (indicators.formFactor.test(lowerDesc)) score += 0.2;
  if (indicators.categories.test(lowerDesc)) score += 0.4;

  return Math.min(score, 1.0);
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
- "element" likely refers to the "LMNT" brand if that's in their history
- "chicken thigh" likely refers to their usual preparation if they log it often
- Pay attention to flavor/variant keywords (citrus, lemonade, chocolate, vanilla, etc.) and match them accurately
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

Event Type Classification Guidelines:
- SUPPLEMENT: Vitamins, minerals, electrolyte drinks (LMNT, Nuun, Liquid IV), protein powders, creatine, herbal supplements, amino acids, pre-workout, nootropics
- MEDICATION: Prescription drugs, over-the-counter medicines (aspirin, ibuprofen, etc.)
- FOOD: Prepared meals, whole foods, snacks, beverages (but NOT electrolyte supplements)

CRITICAL Classification Rules:
1. Electrolyte drinks/powders (LMNT, Nuun, Liquid IV, etc.) are SUPPLEMENTS, not food
2. Protein powders, creatine, amino acids are SUPPLEMENTS, not food
3. Even if something is drinkable or edible, classify by PRIMARY PURPOSE:
   - Primary purpose = nutrition/sustenance → food
   - Primary purpose = supplementation/performance → supplement
4. When uncertain between food and supplement, if it has a brand name commonly associated with supplements → classify as supplement

Rules:
1. Always identify the most appropriate event_type using the classification guidelines above
2. Extract all available information
3. Use reasonable defaults for units (mg/dL for glucose, units for insulin, etc.)
4. For food, try to extract nutritional info if mentioned
5. For timestamps, interpret relative times ("30 min jog" = started 30 min ago)
6. CRITICAL: Match input against user's frequent items for better accuracy (e.g., "element" → "LMNT")
7. CRITICAL: Apply event type classification guidelines - electrolyte drinks are supplements, not food

Example inputs and outputs:
Input: "Log 6 units of basal insulin"
Output: {"event_type": "insulin", "event_data": {"value": 6, "units": "units", "insulin_type": "basal"}, "event_time": "2024-01-01T12:00:00Z", "confidence": 95}

Input: "Ate large chicken thigh with broccoli"
Output: {"event_type": "food", "event_data": {"description": "large chicken thigh with broccoli", "protein": 45, "carbs": 8}, "event_time": "2024-01-01T12:00:00Z", "confidence": 85}

Input: "element citrus"
Output: {"event_type": "supplement", "event_data": {"name": "LMNT Citrus Salt", "dosage": "1 pack", "units": "pack"}, "event_time": "2024-01-01T12:00:00Z", "confidence": 90}

Input: "NOW Vitamin D"
Output: {"event_type": "supplement", "event_data": {"name": "NOW Vitamin D 5000 IU", "dosage": "5000", "units": "IU"}, "event_time": "2024-01-01T12:00:00Z", "confidence": 92}`;

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

    // Post-processing: Reclassify food items that are actually supplements
    // This handles cases where Claude incorrectly classifies electrolyte drinks as food
    if (parsed.event_type === 'food' && parsed.event_data?.description) {
      const reclassified = reclassifyFoodToSupplement(parsed.event_data.description);
      if (reclassified) {
        await Logger.info('parsing', 'Reclassified food as supplement (pattern match)', {
          original_description: parsed.event_data.description,
          original_type: 'food',
          new_type: 'supplement',
          reclassified_name: reclassified.name
        }, userId);

        parsed.event_type = 'supplement';
        parsed.event_data = {
          name: reclassified.name,
          dosage: reclassified.dosage || parsed.event_data.serving_size || '1 serving',
          units: reclassified.units || 'serving'
        };
      } else {
        // If pattern-based reclassification didn't match, try semantic scoring
        const supplementScore = scoreSupplementLikelihood(parsed.event_data.description);
        if (supplementScore >= 0.7) {
          await Logger.info('parsing', 'Reclassified food as supplement (semantic scoring)', {
            original_description: parsed.event_data.description,
            original_type: 'food',
            new_type: 'supplement',
            supplement_score: supplementScore
          }, userId);

          parsed.event_type = 'supplement';
          parsed.event_data = {
            name: parsed.event_data.description,
            dosage: parsed.event_data.serving_size || '1 serving',
            units: 'serving'
          };
        }
      }
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
  // CRITICAL: Validate userId before attempting database insert
  // This prevents RLS policy violations when userId is undefined/null
  if (!userId) {
    const error = new Error('userId is required to create audit record');
    console.error('createAuditRecord validation failed:', {
      userId,
      rawTextPreview: rawText?.substring(0, 50),
      eventType,
      globalUserId: global.userId,
      stack: error.stack
    });
    throw error;
  }

  // Additional validation: ensure userId is a string (UUID format)
  if (typeof userId !== 'string') {
    const error = new Error(`userId must be a string, got: ${typeof userId}`);
    console.error('createAuditRecord type validation failed:', { userId, type: typeof userId });
    throw error;
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    const error = new Error(`userId has invalid UUID format: ${userId}`);
    console.error('createAuditRecord UUID validation failed:', { userId });
    throw error;
  }

  // Log the attempt for debugging
  await Logger.debug('voice_processing', 'Creating audit record', {
    userId,
    eventType,
    rawTextLength: rawText?.length,
    hasValue: value !== null,
    hasUnits: units !== null
  }, userId);

  const result = await supabase
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

  const { data, error } = result || {};

  if (error) {
    console.error('Error creating audit record:', error);
    await Logger.error('voice_processing', 'Failed to create audit record', {
      userId,
      error: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    }, userId);
    throw new Error(`Failed to create audit record: ${error.message}`);
  }

  await Logger.info('voice_processing', 'Audit record created successfully', {
    auditId: data.id,
    userId,
    eventType
  }, userId);

  return data;
}

/**
 * Update audit record status
 */
export async function updateAuditStatus(auditId, status) {
  const result = await supabase
    .from('voice_records_audit')
    .update({ nlp_status: status })
    .eq('id', auditId);

  const { error } = result || {};

  if (error) {
    console.error('Error updating audit status:', error);
    throw new Error('Failed to update audit status');
  }
}

/**
 * Insert event into voice_events table
 */
export async function createVoiceEvent(userId, eventType, eventData, eventTime, sourceRecordId, captureMethod = 'manual') {
  const result = await supabase
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

  const { data, error } = result || {};

  if (error) {
    console.error('Error creating voice event:', error);
    throw new Error('Failed to create voice event');
  }

  // Phase 2: Update user product registry after successful event creation
  // This builds the self-learning classification system
  if (['food', 'supplement', 'medication'].includes(eventType)) {
    const productName = eventData.description || eventData.name;
    const brand = eventData.brand || null;

    if (productName) {
      // Fire and forget - don't block on registry update
      updateUserProductRegistry(userId, eventType, productName, brand)
        .catch(err => {
          console.error('Error updating product registry:', err);
          // Don't throw - registry update is not critical
        });
    }
  }

  // Map event_id to id for consistent interface
  return data ? { ...data, id: data.event_id } : data;
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

    // History fetching removed - user_product_registry now handles product recognition
    // This eliminates a database query on every event, improving performance
    const userHistory = []; // Empty array maintained for backward compatibility

    // Step 1.5: Check user's product registry FIRST (Phase 2 - Self-Learning)
    // This bypasses AI parsing for products the user has confirmed multiple times
    const registryMatch = await checkUserProductRegistry(text, userId);
    if (registryMatch) {
      console.log(`Found exact match in user product registry: ${registryMatch.product_name} (${registryMatch.times_logged} times)`);

      // Create audit record for registry match
      const claudeModel = 'claude-3-opus-20240229';
      const registryMetadata = {
        capture_method: captureMethod,
        claude_model: 'registry_bypass', // Indicate we bypassed AI
        registry_match: {
          source: registryMatch.source,
          times_logged: registryMatch.times_logged,
          product_name: registryMatch.product_name
        },
        confidence: 95 // High confidence from user history
      };

      if (transcriptionMetadata) {
        registryMetadata.transcription = transcriptionMetadata;
      }

      const auditRecord = await createAuditRecord(
        userId,
        text,
        registryMatch.event_type,
        null,
        null,
        claudeModel,
        registryMetadata
      );

      // Create event data based on type
      const eventData = registryMatch.event_type === 'food'
        ? { description: registryMatch.product_name }
        : { name: registryMatch.product_name, dosage: '1 serving', units: 'serving' };

      // Create voice event directly
      const voiceEvent = await createVoiceEvent(
        userId,
        registryMatch.event_type,
        eventData,
        new Date().toISOString(),
        auditRecord.id,
        captureMethod
      );

      // Update audit status
      await updateAuditStatus(auditRecord.id, 'awaiting_user_clarification_success');

      return {
        success: true,
        complete: true,
        event: voiceEvent,
        auditId: auditRecord.id,
        confidence: 95,
        parsed: {
          event_type: registryMatch.event_type,
          event_data: eventData,
          confidence: 95
        },
        productOptions: null, // No search needed
        source: 'user_registry'
      };
    }

    // Step 1.6: Try fuzzy match if no exact match
    const fuzzyMatch = await fuzzyMatchUserProducts(text, userId);
    if (fuzzyMatch) {
      console.log(`Found fuzzy match in user product registry: ${fuzzyMatch.product_name} (${fuzzyMatch.times_logged} times)`);

      // Treat fuzzy matches same as exact matches - bypass AI entirely
      const claudeModel = 'claude-3-opus-20240229';
      const registryMetadata = {
        capture_method: captureMethod,
        claude_model: 'registry_fuzzy_bypass',
        registry_match: {
          source: fuzzyMatch.source,
          times_logged: fuzzyMatch.times_logged,
          product_name: fuzzyMatch.product_name
        },
        confidence: 95
      };

      if (transcriptionMetadata) {
        registryMetadata.transcription = transcriptionMetadata;
      }

      const auditRecord = await createAuditRecord(
        userId,
        text,
        fuzzyMatch.event_type,
        null,
        null,
        claudeModel,
        registryMetadata
      );

      const eventData = fuzzyMatch.event_type === 'food'
        ? { description: fuzzyMatch.product_name }
        : { name: fuzzyMatch.product_name, dosage: '1 serving', units: 'serving' };

      const voiceEvent = await createVoiceEvent(
        userId,
        fuzzyMatch.event_type,
        eventData,
        new Date().toISOString(),
        auditRecord.id,
        captureMethod
      );

      await updateAuditStatus(auditRecord.id, 'awaiting_user_clarification_success');

      return {
        success: true,
        complete: true,
        event: voiceEvent,
        auditId: auditRecord.id,
        confidence: 95,
        parsed: {
          event_type: fuzzyMatch.event_type,
          event_data: eventData,
          confidence: 95
        },
        productOptions: null,
        source: 'user_registry'
      };
    }

    // Step 2: Create initial audit record
    const claudeModel = 'claude-3-opus-20240229';
    const initialMetadata = {
      capture_method: captureMethod,
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
      const claudeOutput = parsed.event_data.description || parsed.event_data.name || '';
      const shouldSearch = shouldSearchProducts(
        parsed.event_type,
        parsed.event_data,
        confidence,
        text,  // userInput
        claudeOutput  // claudeOutput
      );
      console.log(`Product search decision: ${shouldSearch} (confidence: ${confidence}%, type: ${parsed.event_type})`);

      await Logger.info('voice_processing', 'Product search decision', {
        should_search: shouldSearch,
        event_type: parsed.event_type,
        confidence,
        input_text: text,
        claude_output: claudeOutput
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
            confidence: p.confidence,
            database_category: p.database_category
          }))
        }, userId);

        // Phase 3: Database category override
        // If top product has high confidence and database knows its category,
        // trust the database over AI classification
        if (productOptions.length > 0) {
          const topProduct = productOptions[0];
          if (topProduct.confidence > 80 && topProduct.database_category) {
            // Database says it's a supplement, but AI said food?
            if (topProduct.database_category !== parsed.event_type) {
              await Logger.info('parsing', 'Database category override', {
                ai_classified_as: parsed.event_type,
                database_says: topProduct.database_category,
                product_name: topProduct.name,
                product_confidence: topProduct.confidence,
                brand: topProduct.brand
              }, userId);

              console.log(`Database override: changing ${parsed.event_type} -> ${topProduct.database_category}`);

              // Override AI classification with database category
              const originalEventType = parsed.event_type;
              parsed.event_type = topProduct.database_category;

              // Update event_data structure to match new type
              if (parsed.event_type === 'supplement' && parsed.event_data.description) {
                parsed.event_data = {
                  name: parsed.event_data.description,
                  dosage: parsed.event_data.serving_size || '1 serving',
                  units: 'serving',
                  brand: topProduct.brand
                };
              } else if (parsed.event_type === 'food' && parsed.event_data.name) {
                parsed.event_data = {
                  description: parsed.event_data.name,
                  ...(parsed.event_data.dosage && { serving_size: parsed.event_data.dosage })
                };
              }

              // Update audit record with override info
              await supabase
                .from('voice_records_audit')
                .update({
                  record_type: parsed.event_type,
                  nlp_metadata: {
                    ...updatedMetadata,
                    database_override: {
                      original_type: originalEventType,
                      override_type: parsed.event_type,
                      override_source: 'database_category',
                      product_id: topProduct.id,
                      product_source: topProduct.source
                    }
                  }
                })
                .eq('id', auditRecord.id);
            }
          }
        }
      } else {
        console.log('Skipping product search - confidence is high enough');
      }

      // Determine if we should show confirmation screen
      // Only show confirmation if incomplete OR if we have product options to show
      const needsConfirmation = !parsed.complete ||
                                (productOptions?.length > 0 && ['food', 'supplement', 'medication'].includes(parsed.event_type));

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
          auditId: auditRecord.id,
          confidence,
          parsed,  // Include parsed data for test verification
          productOptions  // Include product options (may be null or empty array) for test verification
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
