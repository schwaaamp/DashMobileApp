/**
 * User Product Registry
 * Phase 2: Self-learning product classification based on user's confirmed entries
 *
 * This module manages a per-user product registry that learns from user behavior.
 * Instead of relying solely on AI classification, it builds a knowledge base of
 * products the user has confirmed, enabling faster and more accurate classifications.
 */

import { supabase } from './supabaseClient';
import Logger from './logger';

/**
 * Normalize product name for consistent matching
 * Removes special characters, converts to lowercase, normalizes whitespace
 *
 * @param {string} name - Raw product name
 * @returns {string} Normalized product key
 */
function normalizeProductKey(name) {
  if (!name) return '';

  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')           // Normalize multiple spaces to single space
    .replace(/[^\w\s]/g, '');       // Remove special chars (punctuation, etc.)
}

/**
 * Check if user has logged this exact product before
 * Returns the user's historical classification for exact matches
 *
 * @param {string} description - Product description from user input
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Registry match or null
 */
export async function checkUserProductRegistry(description, userId) {
  if (!description || !userId) return null;

  const productKey = normalizeProductKey(description);

  try {
    const result = await supabase
      .from('user_product_registry')
      .select('event_type, product_name, brand, times_logged')
      .eq('user_id', userId)
      .eq('product_key', productKey)
      .single();

    const { data, error } = result || {};

    if (error) {
      // Not found is expected, not an error
      if (error.code === 'PGRST116') {
        return null;
      }

      await Logger.error('registry', 'Error checking user product registry', {
        product_key: productKey,
        error_message: error.message
      }, userId);
      return null;
    }

    if (!data) {
      return null;
    }

    try {
      await Logger.info('registry', 'Found exact match in user product registry', {
        product_key: productKey,
        event_type: data.event_type,
        times_logged: data.times_logged
      }, userId);
    } catch (logErr) {
      // Don't let logging errors break the main flow
    }

    return {
      event_type: data.event_type,
      product_name: data.product_name,
      brand: data.brand,
      times_logged: data.times_logged,
      source: 'user_registry_exact'
    };
  } catch (err) {
    await Logger.error('registry', 'Exception checking user product registry', {
      product_key: productKey,
      error_message: err.message,
      error_stack: err.stack
    }, userId);
    return null;
  }
}

/**
 * Fuzzy match against user's product registry
 * Handles minor variations like "NOW Vitamin D" vs "NOW Vitamin D 5000 IU"
 * Only matches products logged 3+ times for reliability
 *
 * @param {string} description - Product description from user input
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Fuzzy match or null
 */
export async function fuzzyMatchUserProducts(description, userId) {
  if (!description || !userId) return null;

  try {
    const result = await supabase
      .from('user_product_registry')
      .select('event_type, product_name, product_key, brand, times_logged')
      .eq('user_id', userId)
      .gte('times_logged', 3)  // Only use products logged 3+ times
      .order('times_logged', { ascending: false })
      .limit(50);

    const { data, error } = result || {};

    if (error) {
      await Logger.error('registry', 'Error fuzzy matching user products', {
        error_message: error?.message
      }, userId);
      return null;
    }

    if (!data || data.length === 0) return null;

    const normalizedInput = normalizeProductKey(description);

    // Find best match using substring matching
    for (const product of data) {
      // Check if input contains product key or vice versa
      if (normalizedInput.includes(product.product_key) ||
          product.product_key.includes(normalizedInput)) {
        try {
          await Logger.info('registry', 'Found fuzzy match in user product registry', {
            input: description,
            matched_product: product.product_name,
            event_type: product.event_type,
            times_logged: product.times_logged
          }, userId);
        } catch (logErr) {
          // Don't let logging errors break the main flow
        }

        return {
          event_type: product.event_type,
          product_name: product.product_name,
          brand: product.brand,
          times_logged: product.times_logged,
          source: 'user_registry_fuzzy'
        };
      }
    }

    return null;
  } catch (err) {
    await Logger.error('registry', 'Exception fuzzy matching user products', {
      input: description,
      error_message: err.message,
      error_stack: err.stack
    }, userId);
    return null;
  }
}

/**
 * Add or update product in user's registry
 * Called when user confirms an entry (after saving voice_event)
 *
 * @param {string} userId - User ID
 * @param {string} eventType - Event type (food, supplement, medication)
 * @param {string} productName - Product name
 * @param {string} brand - Brand name (optional)
 * @param {string} externalProductId - External product ID (optional)
 * @param {string} externalSource - External source (openfoodfacts, usda, etc.)
 * @returns {Promise<boolean>} Success status
 */
export async function updateUserProductRegistry(
  userId,
  eventType,
  productName,
  brand = null,
  externalProductId = null,
  externalSource = null
) {
  if (!userId || !eventType || !productName) {
    await Logger.error('registry', 'Missing required parameters for registry update', {
      has_user_id: !!userId,
      has_event_type: !!eventType,
      has_product_name: !!productName
    }, userId);
    return false;
  }

  const productKey = normalizeProductKey(productName);

  try {
    // Check if entry already exists
    const existingResult = await supabase
      .from('user_product_registry')
      .select('id, times_logged')
      .eq('user_id', userId)
      .eq('product_key', productKey)
      .single();

    const { data: existing, error: selectError } = existingResult || {};

    if (selectError && selectError.code !== 'PGRST116') {
      await Logger.error('registry', 'Error checking existing registry entry', {
        product_key: productKey,
        error_message: selectError.message
      }, userId);
      return false;
    }

    if (existing) {
      // Update existing entry
      const updateResult = await supabase
        .from('user_product_registry')
        .update({
          times_logged: existing.times_logged + 1,
          last_logged_at: new Date().toISOString(),
          // Update brand/external info if provided
          ...(brand && { brand }),
          ...(externalProductId && { external_product_id: externalProductId }),
          ...(externalSource && { external_source: externalSource })
        })
        .eq('id', existing.id);

      const { error: updateError } = updateResult || {};

      if (updateError) {
        await Logger.error('registry', 'Error updating user product registry', {
          product_key: productKey,
          error_message: updateError.message
        }, userId);
        return false;
      }

      await Logger.info('registry', 'Updated user product registry', {
        product_name: productName,
        times_logged: existing.times_logged + 1
      }, userId);
    } else {
      // Create new entry
      const insertResult = await supabase
        .from('user_product_registry')
        .insert({
          user_id: userId,
          product_key: productKey,
          event_type: eventType,
          product_name: productName,
          brand,
          external_product_id: externalProductId,
          external_source: externalSource,
          times_logged: 1
        });

      const { error: insertError } = insertResult || {};

      if (insertError) {
        await Logger.error('registry', 'Error inserting user product registry', {
          product_key: productKey,
          error_message: insertError.message
        }, userId);
        return false;
      }

      await Logger.info('registry', 'Created user product registry entry', {
        product_name: productName,
        event_type: eventType
      }, userId);
    }

    return true;
  } catch (err) {
    await Logger.error('registry', 'Exception updating user product registry', {
      product_name: productName,
      error_message: err.message,
      error_stack: err.stack
    }, userId);
    return false;
  }
}

/**
 * Check classification corrections history
 * Used to learn from cases where user corrected AI's classification
 *
 * @param {string} userInput - Raw user input
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Correction match or null
 */
export async function checkClassificationCorrections(userInput, userId) {
  if (!userInput || !userId) return null;

  try {
    const result = await supabase
      .from('classification_corrections')
      .select('corrected_event_type, selected_product_name')
      .eq('user_id', userId)
      .ilike('user_input', `%${userInput}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data, error } = result || {};

    if (error) {
      // Table might not exist yet (Phase 4)
      if (error.code === '42P01') return null;

      await Logger.error('registry', 'Error checking classification corrections', {
        error_message: error.message
      }, userId);
      return null;
    }

    if (!data || data.length === 0) return null;

    await Logger.info('registry', 'Found classification correction', {
      user_input: userInput,
      corrected_type: data[0].corrected_event_type
    }, userId);

    return {
      event_type: data[0].corrected_event_type,
      product_name: data[0].selected_product_name,
      source: 'user_correction'
    };
  } catch (err) {
    await Logger.error('registry', 'Exception checking classification corrections', {
      user_input: userInput,
      error_message: err.message,
      error_stack: err.stack
    }, userId);
    return null;
  }
}
