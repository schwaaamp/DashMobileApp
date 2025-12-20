/**
 * Logging Infrastructure
 * Provides structured, sanitized logging to Supabase for debugging and monitoring
 */

import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

// Log levels
const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

// Sensitive fields to redact
const SENSITIVE_FIELDS = [
  'api_key', 'apikey', 'token', 'password', 'email',
  'phone', 'ssn', 'address', 'credit_card', 'x-api-key'
];

/**
 * Sanitize data before logging
 * Removes PII and sensitive information
 */
function sanitize(data) {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitize(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    // Redact sensitive fields
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Redact health data (but keep event_type and structure info)
    if (key === 'event_data' && typeof value === 'object') {
      sanitized[key] = {
        event_type: value.event_type || 'unknown',
        has_description: !!value.description,
        has_serving_size: !!value.serving_size,
        has_calories: !!value.calories,
        fields_present: Object.keys(value)
      };
      continue;
    }

    // Recursively sanitize nested objects
    sanitized[key] = typeof value === 'object' ? sanitize(value) : value;
  }

  return sanitized;
}

/**
 * Get app version from package.json
 */
function getAppVersion() {
  try {
    // In production, you'd import from package.json or Constants
    return '1.0.0';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Main logging function
 * @param {string} level - Log level (debug, info, warn, error)
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {object} metadata - Additional metadata
 * @param {string} userId - User ID (optional but recommended for RLS)
 */
async function log(level, category, message, metadata = {}, userId = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    metadata: sanitize(metadata),
    session_id: global.sessionId || 'unknown',
    user_id: userId || global.userId || null,  // Support both parameter and global
    app_version: getAppVersion(),
    platform: Platform.OS
  };

  // Always log to console in development
  if (__DEV__) {
    const consoleMethod = level === LOG_LEVELS.ERROR ? 'error' :
                         level === LOG_LEVELS.WARN ? 'warn' : 'log';
    console[consoleMethod](`[${category}] ${message}`, metadata);
  }

  // Store in Supabase (async, don't block execution)
  try {
    // Fire and forget - don't await to avoid blocking
    const insertResult = supabase.from('app_logs').insert(logEntry);

    // insertResult might be undefined if Supabase client is misconfigured
    if (insertResult && typeof insertResult.then === 'function') {
      insertResult.then((result) => {
        const { error } = result || {};
        if (error && __DEV__) {
          console.error('Failed to store log:', error);
        }
      }).catch((err) => {
        // Catch promise rejection
        if (__DEV__) {
          console.error('Failed to store log (promise rejected):', err);
        }
      });
    } else if (__DEV__) {
      console.warn('Logger: Supabase insert did not return a Promise');
    }
  } catch (error) {
    // Fallback: log to console if Supabase fails
    if (__DEV__) {
      console.error('Failed to store log:', error);
    }
  }

  // Return a resolved promise so callers can await without blocking
  return Promise.resolve();
}

// Convenience methods
export const Logger = {
  debug: async (category, message, metadata, userId) => await log(LOG_LEVELS.DEBUG, category, message, metadata, userId),
  info: async (category, message, metadata, userId) => await log(LOG_LEVELS.INFO, category, message, metadata, userId),
  warn: async (category, message, metadata, userId) => await log(LOG_LEVELS.WARN, category, message, metadata, userId),
  error: async (category, message, metadata, userId) => await log(LOG_LEVELS.ERROR, category, message, metadata, userId),

  /**
   * Track API calls with timing and response info
   */
  apiCall: async (apiName, endpoint, request, response, duration, userId) => {
    const requestSize = request ? JSON.stringify(request).length : 0;
    const responseSize = response ? JSON.stringify(response).length : 0;

    await log(LOG_LEVELS.INFO, 'api', `${apiName} call`, {
      endpoint,
      request_size: requestSize,
      response_status: response?.status,
      response_ok: response?.ok,
      response_size: responseSize,
      duration_ms: duration,
      success: response?.ok || false
    }, userId);
  },

  /**
   * Track parsing attempts and failures
   */
  parsingAttempt: async (input, result, error = null, userId) => {
    await log(
      error ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO,
      'parsing',
      error ? 'Parsing failed' : 'Parsing succeeded',
      {
        input_length: input?.length,
        input_type: typeof input,
        input_preview: input?.substring ? input.substring(0, 100) : null,
        result_type: result?.event_type,
        has_product_options: !!result?.productOptions,
        product_count: result?.productOptions?.length || 0,
        error: error?.message,
        error_stack: error?.stack?.split('\n').slice(0, 3) // First 3 lines only
      },
      userId
    );
  },

  /**
   * Track user actions and interactions
   */
  userAction: async (action, details, userId) => {
    await log(LOG_LEVELS.INFO, 'user_action', action, details, userId);
  },

  /**
   * Track JSON extraction attempts for malformed responses
   */
  jsonExtraction: async (rawText, method, success, error = null, userId) => {
    await log(
      success ? LOG_LEVELS.INFO : LOG_LEVELS.WARN,
      'json_extraction',
      success ? `JSON extracted via ${method}` : 'All extraction methods failed',
      {
        raw_text_length: rawText?.length,
        raw_text_preview: rawText?.substring(0, 200),
        extraction_method: method,
        success,
        error: error?.message
      },
      userId
    );
  }
};

// Generate session ID on app start (if not already set)
if (!global.sessionId) {
  global.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Log session start
  Logger.info('session', 'Session started', {
    session_id: global.sessionId,
    platform: Platform.OS,
    timestamp: new Date().toISOString()
  });
}
