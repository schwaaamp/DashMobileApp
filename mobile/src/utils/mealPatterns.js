/**
 * Meal Pattern Detection & Template Learning System
 *
 * Detects recurring meal patterns by analyzing voice_events history.
 * Patterns are computed on-demand from the source of truth (voice_events).
 * Templates are only persisted when user explicitly confirms.
 *
 * Key Design Principles:
 * - voice_events is the source of truth
 * - No intermediate pattern storage
 * - 2 occurrences = suggestion threshold
 * - 70% similarity for partial matching
 */

import { supabase } from './supabaseClient';
import { normalizeProductKey } from './productCatalog';

// Configuration
const DEFAULT_TIME_WINDOW_MINUTES = 30;
const DEFAULT_MIN_OCCURRENCES = 2;
const DEFAULT_LOOKBACK_DAYS = 30;
const SIMILARITY_THRESHOLD = 0.7;

/**
 * Analyze voice_events to find recurring meal patterns
 *
 * @param {string} userId - User ID
 * @param {Object} options
 * @param {number} options.timeWindowMinutes - Window for grouping items (default: 30)
 * @param {number} options.minOccurrences - Minimum times pattern must occur (default: 2)
 * @param {number} options.lookbackDays - How far back to analyze (default: 30)
 * @returns {Promise<Array<{fingerprint: string, items: Array, occurrences: number, typicalHour: number}>>}
 */
export async function detectMealPatterns(userId, options = {}) {
  const {
    timeWindowMinutes = DEFAULT_TIME_WINDOW_MINUTES,
    minOccurrences = DEFAULT_MIN_OCCURRENCES,
    lookbackDays = DEFAULT_LOOKBACK_DAYS
  } = options;

  if (!userId) return [];

  // 1. Fetch recent events
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  const { data: events, error } = await supabase
    .from('voice_events')
    .select('id, event_type, event_data, event_time, product_catalog_id')
    .eq('user_id', userId)
    .gte('event_time', cutoffDate.toISOString())
    .in('event_type', ['food', 'supplement', 'medication'])
    .order('event_time', { ascending: true });

  if (error) {
    console.error('[detectMealPatterns] Error fetching events:', error);
    return [];
  }

  if (!events?.length) return [];

  // 2. Group events into "sessions" (items logged within timeWindowMinutes of each other)
  const sessions = groupEventsIntoSessions(events, timeWindowMinutes);

  // 3. Generate fingerprints for each session
  const sessionFingerprints = sessions.map(session => ({
    fingerprint: generateMealFingerprint(session.items),
    items: session.items,
    hour: new Date(session.startTime).getHours()
  }));

  // 4. Count fingerprint occurrences
  const fingerprintCounts = countFingerprints(sessionFingerprints);

  // 5. Filter to patterns that meet minimum occurrence threshold
  const patterns = Object.entries(fingerprintCounts)
    .filter(([_, data]) => data.count >= minOccurrences)
    .map(([fingerprint, data]) => ({
      fingerprint,
      items: data.items,
      occurrences: data.count,
      typicalHour: Math.round(data.totalHours / data.count)
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  // 6. Exclude patterns that already exist as templates
  const { data: existingTemplates } = await supabase
    .from('user_meal_templates')
    .select('fingerprint')
    .eq('user_id', userId);

  const existingFingerprints = new Set(existingTemplates?.map(t => t.fingerprint) || []);

  return patterns.filter(p => !existingFingerprints.has(p.fingerprint));
}

/**
 * Group events that were logged within windowMinutes of each other
 *
 * @param {Array} events - Sorted events from voice_events
 * @param {number} windowMinutes - Time window for grouping
 * @returns {Array<{items: Array, startTime: string, endTime: string}>}
 */
export function groupEventsIntoSessions(events, windowMinutes) {
  if (!events?.length) return [];

  const sessions = [];
  let currentSession = {
    items: [extractItemFromEvent(events[0])],
    startTime: events[0].event_time,
    endTime: events[0].event_time
  };

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    const prevTime = new Date(currentSession.endTime);
    const currTime = new Date(event.event_time);
    const diffMinutes = (currTime - prevTime) / (1000 * 60);

    if (diffMinutes <= windowMinutes) {
      // Same session - add to current
      currentSession.items.push(extractItemFromEvent(event));
      currentSession.endTime = event.event_time;
    } else {
      // New session - save current and start new
      if (currentSession.items.length >= 2) {
        sessions.push(currentSession);
      }
      currentSession = {
        items: [extractItemFromEvent(event)],
        startTime: event.event_time,
        endTime: event.event_time
      };
    }
  }

  // Don't forget last session
  if (currentSession.items.length >= 2) {
    sessions.push(currentSession);
  }

  return sessions;
}

/**
 * Extract item data from a voice_event record
 *
 * @param {Object} event - voice_events record
 * @returns {Object} - Normalized item data
 */
export function extractItemFromEvent(event) {
  const eventData = event.event_data || {};

  // Get name from event_data based on event type
  let name = eventData.name || eventData.description || '';

  // For food events, description is the main field
  if (event.event_type === 'food') {
    name = eventData.description || name;
  }

  return {
    product_id: event.product_catalog_id || null,
    name: name,
    event_type: event.event_type,
    // Include nutritional data if available
    calories: eventData.calories || null,
    dosage: eventData.dosage || null,
    units: eventData.units || null
  };
}

/**
 * Create a sortable, comparable fingerprint from items
 * Uses product_catalog_id when available, falls back to normalized name
 *
 * @param {Array} items - Array of {product_id, name, event_type}
 * @returns {string} - Normalized fingerprint like "uuid-123|uuid-456|vitamin-d"
 */
export function generateMealFingerprint(items) {
  if (!items?.length) return '';

  return items
    .map(item => item.product_id || normalizeProductKey(item.name))
    .filter(id => id) // Remove empty values
    .sort()
    .join('|');
}

/**
 * Count fingerprint occurrences across sessions
 *
 * @param {Array} sessionFingerprints - Array of {fingerprint, items, hour}
 * @returns {Object} - Map of fingerprint -> {count, items, totalHours}
 */
function countFingerprints(sessionFingerprints) {
  const counts = {};

  for (const session of sessionFingerprints) {
    if (!session.fingerprint) continue;

    if (!counts[session.fingerprint]) {
      counts[session.fingerprint] = {
        count: 0,
        items: session.items,
        totalHours: 0
      };
    }

    counts[session.fingerprint].count++;
    counts[session.fingerprint].totalHours += session.hour;
  }

  return counts;
}

/**
 * Calculate how similar two meal patterns are using Jaccard similarity
 * Used for suggesting existing templates when user logs partial match
 *
 * @param {string} fingerprint1 - First pattern fingerprint
 * @param {string} fingerprint2 - Second pattern fingerprint
 * @returns {number} - Similarity score 0-1
 */
export function calculatePatternSimilarity(fingerprint1, fingerprint2) {
  if (!fingerprint1 || !fingerprint2) return 0;

  const set1 = new Set(fingerprint1.split('|'));
  const set2 = new Set(fingerprint2.split('|'));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Check if current items match a template or emerging pattern
 * Called during event logging to offer shortcuts
 *
 * @param {string} userId
 * @param {Array} currentItems - Items user is about to log
 * @returns {Promise<{type: 'template'|'pattern'|null, data?: Object, similarity: number}>}
 */
export async function checkForPatternMatch(userId, currentItems) {
  if (!userId || !currentItems?.length) {
    return { type: null, similarity: 0 };
  }

  const currentFingerprint = generateMealFingerprint(currentItems);
  if (!currentFingerprint) {
    return { type: null, similarity: 0 };
  }

  // 1. Check existing templates first (confirmed patterns)
  const { data: templates } = await supabase
    .from('user_meal_templates')
    .select('*')
    .eq('user_id', userId);

  for (const template of templates || []) {
    if (!template.fingerprint) continue;

    const similarity = calculatePatternSimilarity(currentFingerprint, template.fingerprint);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return {
        type: 'template',
        data: template,
        similarity
      };
    }
  }

  // 2. Check for emerging patterns (not yet templates)
  const patterns = await detectMealPatterns(userId, { minOccurrences: DEFAULT_MIN_OCCURRENCES });

  for (const pattern of patterns) {
    const similarity = calculatePatternSimilarity(currentFingerprint, pattern.fingerprint);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return {
        type: 'pattern',
        data: pattern,
        similarity
      };
    }
  }

  return { type: null, similarity: 0 };
}

/**
 * Check if any new patterns have reached the threshold
 * Uses voice_events as source of truth - no separate storage needed
 *
 * @param {string} userId
 * @param {Object} options
 * @returns {Promise<Array>} - Patterns that meet threshold (not yet templates)
 */
export async function checkForNewPatterns(userId, options = {}) {
  // Query voice_events to detect patterns
  // detectMealPatterns already excludes existing templates
  return detectMealPatterns(userId, options);
}

/**
 * Create a confirmed template from a detected pattern
 * Called when user accepts a pattern suggestion
 *
 * @param {string} userId
 * @param {Object} pattern - Pattern data from detectMealPatterns
 * @param {string} templateName - User-provided name
 * @returns {Promise<Object>} - Created template
 */
export async function createTemplateFromPattern(userId, pattern, templateName) {
  if (!userId || !pattern || !templateName) {
    throw new Error('Missing required parameters');
  }

  // Generate time range from typical hour (±1 hour window)
  const typicalHour = pattern.typicalHour || 12;
  const startHour = Math.max(0, typicalHour - 1);
  const endHour = Math.min(23, typicalHour + 1);
  const timeRange = `${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:59`;

  const { data: template, error } = await supabase
    .from('user_meal_templates')
    .insert({
      user_id: userId,
      template_name: templateName,
      template_key: normalizeProductKey(templateName),
      fingerprint: pattern.fingerprint,
      items: pattern.items,
      typical_time_range: timeRange,
      times_logged: 0,  // User hasn't used it via template yet
      first_logged_at: new Date().toISOString(),
      auto_generated: true
    })
    .select()
    .single();

  if (error) {
    console.error('[createTemplateFromPattern] Error:', error);
    throw error;
  }

  return template;
}

/**
 * Get a template to suggest based on current time
 * Only suggests templates that haven't been logged today
 *
 * @param {string} userId
 * @returns {Promise<Object|null>} - Template to suggest, or null
 */
export async function getSuggestedTemplate(userId) {
  if (!userId) return null;

  const now = new Date();
  const currentHour = now.getHours();
  const currentTime = `${String(currentHour).padStart(2, '0')}:00`;

  // Find templates matching current time window
  const { data: templates, error } = await supabase
    .from('user_meal_templates')
    .select('*')
    .eq('user_id', userId)
    .order('times_logged', { ascending: false });

  if (error || !templates?.length) return null;

  // Filter by time range
  const matching = templates.filter(t => {
    if (!t.typical_time_range) return false;
    const [start, end] = t.typical_time_range.split('-');
    return currentTime >= start && currentTime <= end;
  });

  // Don't suggest if already logged today
  if (matching.length > 0) {
    const template = matching[0];
    const alreadyLoggedToday = await checkIfLoggedToday(userId, template.id);
    return alreadyLoggedToday ? null : template;
  }

  return null;
}

/**
 * Check if user already logged this template today
 *
 * @param {string} userId
 * @param {string} templateId
 * @returns {Promise<boolean>}
 */
async function checkIfLoggedToday(userId, templateId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('voice_events')
    .select('id')
    .eq('user_id', userId)
    .eq('template_id', templateId)
    .gte('event_time', today.toISOString())
    .limit(1);

  return data?.length > 0;
}

/**
 * Increment template usage counter and update last_logged_at
 *
 * @param {string} templateId
 * @returns {Promise<void>}
 */
export async function incrementTemplateUsage(templateId) {
  if (!templateId) return;

  try {
    const { data: template } = await supabase
      .from('user_meal_templates')
      .select('times_logged')
      .eq('id', templateId)
      .single();

    if (template) {
      await supabase
        .from('user_meal_templates')
        .update({
          times_logged: (template.times_logged || 0) + 1,
          last_logged_at: new Date().toISOString()
        })
        .eq('id', templateId);
    }
  } catch (error) {
    console.error('[incrementTemplateUsage] Error:', error);
  }
}

/**
 * Update template with new default quantities based on user selections
 * Uses weighted average to learn from usage patterns
 *
 * @param {string} templateId
 * @param {Object} newQuantities - Map of item index to quantity
 * @returns {Promise<void>}
 */
export async function learnTemplateQuantities(templateId, newQuantities) {
  if (!templateId || !newQuantities) return;

  try {
    const { data: template } = await supabase
      .from('user_meal_templates')
      .select('items')
      .eq('id', templateId)
      .single();

    if (!template?.items) return;

    // Weighted average of old and new quantities
    // 70% weight to historical, 30% to new
    const updatedItems = template.items.map((item, i) => {
      const oldQty = item.default_quantity || 1;
      const newQty = newQuantities[i] !== undefined ? newQuantities[i] : oldQty;

      const learned = Math.round((oldQty * 0.7 + newQty * 0.3) * 10) / 10;

      return { ...item, default_quantity: learned };
    });

    await supabase
      .from('user_meal_templates')
      .update({ items: updatedItems })
      .eq('id', templateId);
  } catch (error) {
    console.error('[learnTemplateQuantities] Error:', error);
  }
}

/**
 * Delete a meal template
 *
 * @param {string} templateId
 * @param {string} userId - For RLS verification
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteTemplate(templateId, userId) {
  if (!templateId || !userId) return false;

  try {
    const { error } = await supabase
      .from('user_meal_templates')
      .delete()
      .eq('id', templateId)
      .eq('user_id', userId);

    return !error;
  } catch (error) {
    console.error('[deleteTemplate] Error:', error);
    return false;
  }
}

/**
 * Get all templates for a user
 *
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export async function getUserTemplates(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('user_meal_templates')
    .select('*')
    .eq('user_id', userId)
    .order('times_logged', { ascending: false });

  if (error) {
    console.error('[getUserTemplates] Error:', error);
    return [];
  }

  return data || [];
}

/**
 * Match a voice transcription to an existing template
 * Detects phrases like "my morning vitamins", "usual breakfast", "log my stack"
 *
 * @param {string} transcription - Voice transcription text
 * @param {string} userId - User ID
 * @returns {Promise<{matched: boolean, template?: Object, confidence: number}>}
 */
export async function matchTemplateByVoice(transcription, userId) {
  if (!transcription || !userId) {
    return { matched: false, confidence: 0 };
  }

  const normalized = transcription.toLowerCase().trim();

  // Common template trigger phrases - extract potential template name
  // Order matters: more specific patterns first (with prefixes), generic last
  const triggers = [
    // "log my morning vitamins", "log the usual breakfast"
    /^log\s+(?:my |the )?(?:usual |regular |normal )?(.+)$/i,
    // "took my morning stack", "had my breakfast vitamins", "take my evening supplements"
    /^(?:took|had|ate|take)\s+(?:my |the )?(?:usual |regular |normal )?(.+)$/i,
    // "my morning vitamins", "my usual stack", "my breakfast routine"
    /^(?:my |the )(?:usual |regular |normal )?(.+)$/i,
    // Direct template name: "morning stack", "breakfast vitamins"
    /^(.+)$/i,
  ];

  let potentialName = null;

  for (const trigger of triggers) {
    const match = normalized.match(trigger);
    if (match && match[1]) {
      let captured = match[1].trim();
      // Remove trailing keywords that are template type indicators, but keep the full phrase too
      // This allows matching "morning vitamins" template with "morning vitamins" input
      const withoutSuffix = captured.replace(/\s+(routine|stack|combo|meal|supplements?|vitamins?)$/i, '').trim();
      // Use the version without suffix only if it still has meaningful content
      // Otherwise keep the original (e.g., "evening supplements" stays as-is for matching)
      if (withoutSuffix.length > 2 && !['my', 'the', 'a', 'an', 'usual', 'regular', 'normal'].includes(withoutSuffix)) {
        // Keep the full captured phrase for better matching
        potentialName = captured;
        break;
      } else if (captured.length > 2 && !['my', 'the', 'a', 'an', 'usual', 'regular', 'normal'].includes(captured)) {
        potentialName = captured;
        break;
      }
    }
  }

  if (!potentialName) {
    return { matched: false, confidence: 0 };
  }

  // Fetch user's templates
  const { data: templates } = await supabase
    .from('user_meal_templates')
    .select('*')
    .eq('user_id', userId);

  if (!templates?.length) {
    return { matched: false, confidence: 0 };
  }

  // Find best matching template
  let bestMatch = null;
  let bestScore = 0;

  const searchKey = normalizeProductKey(potentialName);

  for (const template of templates) {
    const templateKey = template.template_key.toLowerCase();
    const templateName = template.template_name.toLowerCase();

    let score = 0;

    // Exact match on template_key
    if (templateKey === searchKey) {
      score = 1.0;
    }
    // Template key contains search term
    else if (templateKey.includes(searchKey)) {
      score = 0.9;
    }
    // Search term contains template key
    else if (searchKey.includes(templateKey)) {
      score = 0.85;
    }
    // Template name contains search term
    else if (templateName.includes(searchKey)) {
      score = 0.8;
    }
    // Search term contains template name
    else if (searchKey.includes(templateName.replace(/\s+/g, ''))) {
      score = 0.75;
    }
    // Check individual words
    else {
      const searchWords = searchKey.split(/\s+/);
      const templateWords = templateKey.split(/\s+/);
      const matchedWords = searchWords.filter(w => templateWords.some(tw => tw.includes(w) || w.includes(tw)));
      if (matchedWords.length > 0) {
        score = 0.5 + (matchedWords.length / Math.max(searchWords.length, templateWords.length)) * 0.3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = template;
    }
  }

  // Require at least 70% confidence to match
  if (bestScore >= 0.7 && bestMatch) {
    return {
      matched: true,
      template: bestMatch,
      confidence: bestScore
    };
  }

  return { matched: false, confidence: bestScore };
}
