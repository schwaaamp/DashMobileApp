/**
 * Logging Integration Tests
 *
 * Tests that logs are properly written to the database as users
 * engage with voice, text, and photo logging capabilities.
 *
 * CRITICAL: These are integration tests that require:
 * 1. A real Supabase connection (test database)
 * 2. The app_logs table to exist
 * 3. Proper RLS policies configured
 */

import { Logger } from '@/utils/logger';
import { processTextInput } from '@/utils/voiceEventParser';
import { searchAllProducts } from '@/utils/productSearch';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

// Mock Supabase for unit tests
// For integration tests, use a real test database
jest.mock('@/utils/supabaseClient');

describe('Logging Integration Tests', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  let insertedLogs = [];

  beforeEach(() => {
    jest.clearAllMocks();
    insertedLogs = [];

    // Mock Supabase insert to capture logs
    supabase.from = jest.fn((table) => {
      if (table === 'app_logs') {
        return {
          insert: jest.fn((logEntry) => {
            insertedLogs.push(logEntry);
            return {
              then: jest.fn((callback) => {
                callback({ error: null });
                return Promise.resolve();
              })
            };
          })
        };
      }
      // Use shared mock for other tables
      return createSupabaseMock({ auditId: 'mock-id' })(table);
    });
  });

  describe('Logger.info() - Basic Logging', () => {
    it('should write log entry with all required fields', async () => {
      await Logger.info('test', 'Test message', { test_data: 'value' }, mockUserId);

      expect(insertedLogs.length).toBe(1);
      const log = insertedLogs[0];

      expect(log.level).toBe('info');
      expect(log.category).toBe('test');
      expect(log.message).toBe('Test message');
      expect(log.user_id).toBe(mockUserId);
      expect(log.platform).toBeDefined();
      expect(log.session_id).toBeDefined();
      expect(log.timestamp).toBeDefined();
    });

    it('should include user_id from parameter', async () => {
      await Logger.info('test', 'Test', {}, mockUserId);

      expect(insertedLogs[0].user_id).toBe(mockUserId);
    });

    it('should fall back to global.userId if parameter not provided', async () => {
      global.userId = 'global-user-456';
      await Logger.info('test', 'Test', {});

      expect(insertedLogs[0].user_id).toBe('global-user-456');
      delete global.userId;
    });

    it('should sanitize sensitive data in metadata', async () => {
      await Logger.info('test', 'Test', {
        api_key: 'secret-key',
        user_email: 'test@example.com',
        normal_data: 'visible'
      }, mockUserId);

      const metadata = insertedLogs[0].metadata;
      expect(metadata.api_key).toBe('[REDACTED]');
      expect(metadata.user_email).toBe('[REDACTED]');
      expect(metadata.normal_data).toBe('visible');
    });
  });

  describe('Voice Processing Flow - End to End Logging', () => {
    beforeEach(() => {
      // Mock Claude API
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'food',
                  event_data: {
                    description: 'LMNT Citrus Salt',
                    calories: 0
                  },
                  event_time: new Date().toISOString(),
                  confidence: 85
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });
    });

    it('should log voice_processing start when text input is processed', async () => {
      await processTextInput('citrus element pack', mockUserId, 'test-api-key', 'voice');

      const voiceProcessingLogs = insertedLogs.filter(log => log.category === 'voice_processing');
      expect(voiceProcessingLogs.length).toBeGreaterThan(0);

      const startLog = voiceProcessingLogs.find(log => log.message === 'Starting text input processing');
      expect(startLog).toBeDefined();
      expect(startLog.metadata.input_text).toBe('citrus element pack');
      expect(startLog.metadata.capture_method).toBe('voice');
      expect(startLog.user_id).toBe(mockUserId);
    });

    it('should log Claude API call with timing', async () => {
      await processTextInput('test input', mockUserId, 'test-api-key', 'voice');

      const apiLogs = insertedLogs.filter(log => log.category === 'api');
      const claudeLog = apiLogs.find(log => log.message.includes('Claude call'));

      expect(claudeLog).toBeDefined();
      expect(claudeLog.metadata.endpoint).toBe('/v1/messages');
      expect(claudeLog.metadata.duration_ms).toBeDefined();
      expect(claudeLog.metadata.response_status).toBe(200);
      expect(claudeLog.user_id).toBe(mockUserId);
    });

    it('should log parsing attempt with result', async () => {
      await processTextInput('test input', mockUserId, 'test-api-key', 'voice');

      const parsingLogs = insertedLogs.filter(log => log.category === 'parsing');
      const successLog = parsingLogs.find(log => log.message === 'Parsing succeeded');

      expect(successLog).toBeDefined();
      expect(successLog.metadata.result_type).toBe('food');
      expect(successLog.user_id).toBe(mockUserId);
    });

    it('should log raw API response before parsing', async () => {
      await processTextInput('test input', mockUserId, 'test-api-key', 'voice');

      const parsingLogs = insertedLogs.filter(log => log.category === 'parsing');
      const responseLog = parsingLogs.find(log => log.message === 'Received Claude API response');

      expect(responseLog).toBeDefined();
      expect(responseLog.metadata.response_length).toBeGreaterThan(0);
      expect(responseLog.metadata.response_preview).toBeDefined();
      expect(responseLog.user_id).toBe(mockUserId);
    });

    it('should log product search decision', async () => {
      await processTextInput('citrus element pack', mockUserId, 'test-api-key', 'voice');

      const searchDecisionLog = insertedLogs.find(
        log => log.category === 'voice_processing' && log.message === 'Product search decision'
      );

      expect(searchDecisionLog).toBeDefined();
      expect(searchDecisionLog.metadata.should_search).toBeDefined();
      // "citrus element pack" gets reclassified from food to supplement (LMNT)
      expect(searchDecisionLog.metadata.event_type).toBe('supplement');
      expect(searchDecisionLog.user_id).toBe(mockUserId);
    });
  });

  describe('Product Search Flow - End to End Logging', () => {
    beforeEach(() => {
      // Mock Open Food Facts API
      global.fetch = jest.fn((url) => {
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              products: [
                {
                  code: '12345',
                  product_name: 'LMNT Citrus Salt',
                  brands: 'LMNT',
                  nutriments: {
                    'energy-kcal_100g': 0,
                    proteins_100g: 0,
                    carbohydrates_100g: 0,
                    fat_100g: 0
                  }
                }
              ]
            })
          });
        }
        if (url.includes('api.nal.usda.gov')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ foods: [] })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });
    });

    it('should log product search start', async () => {
      await searchAllProducts('citrus element pack', null);

      const searchStartLog = insertedLogs.find(
        log => log.category === 'product_search' && log.message === 'Starting product search'
      );

      expect(searchStartLog).toBeDefined();
      expect(searchStartLog.metadata.query).toBe('citrus element pack');
      expect(searchStartLog.metadata.query_length).toBe(19); // 'citrus element pack' is 19 characters
    });

    it('should log phonetic variations created', async () => {
      await searchAllProducts('element lemonade', null);

      const variationsLog = insertedLogs.find(
        log => log.category === 'product_search' && log.message === 'Created phonetic variations'
      );

      expect(variationsLog).toBeDefined();
      expect(variationsLog.metadata.original_query).toBe('element lemonade');
      expect(variationsLog.metadata.variations).toBeDefined();
      expect(variationsLog.metadata.variations_count).toBeGreaterThan(0);
    });

    it('should log Open Food Facts API call', async () => {
      await searchAllProducts('lmnt', null);

      const apiLogs = insertedLogs.filter(log => log.category === 'api');
      const offLog = apiLogs.find(log => log.message.includes('OpenFoodFacts'));

      expect(offLog).toBeDefined();
      expect(offLog.metadata.endpoint).toBe('/cgi/search.pl');
      expect(offLog.metadata.duration_ms).toBeDefined();
      expect(offLog.metadata.response_status).toBe(200);
    });

    it('should log product search completion with results', async () => {
      await searchAllProducts('lmnt', null);

      const completionLog = insertedLogs.find(
        log => log.category === 'product_search' && log.message === 'Product search completed'
      );

      expect(completionLog).toBeDefined();
      expect(completionLog.metadata.total_unique_products).toBeDefined();
      expect(completionLog.metadata.top_10_results).toBeDefined();
      expect(Array.isArray(completionLog.metadata.top_10_results)).toBe(true);
    });

    it('should log Open Food Facts search completion', async () => {
      await searchAllProducts('test', null);

      const offCompletionLog = insertedLogs.find(
        log => log.category === 'product_search' && log.message === 'Open Food Facts search completed'
      );

      expect(offCompletionLog).toBeDefined();
      expect(offCompletionLog.metadata.query).toBe('test');
      expect(offCompletionLog.metadata.results_count).toBeDefined();
      expect(offCompletionLog.metadata.duration_ms).toBeDefined();
    });
  });

  describe('Error Logging', () => {
    it('should log parsing errors with full context', async () => {
      // Mock Claude to return invalid JSON
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          content: [{
            text: 'Not valid JSON at all'
          }]
        })
      }));

      try {
        await processTextInput('test', mockUserId, 'test-api-key', 'voice');
      } catch (error) {
        // Expected to fail
      }

      const errorLogs = insertedLogs.filter(log => log.level === 'error');
      expect(errorLogs.length).toBeGreaterThan(0);

      const parsingError = errorLogs.find(log => log.category === 'parsing');
      expect(parsingError).toBeDefined();
      expect(parsingError.metadata.input_text).toBe('test');
      expect(parsingError.metadata.raw_response).toBeDefined();
      expect(parsingError.user_id).toBe(mockUserId);
    });

    it('should log API call failures', async () => {
      // Mock API failure
      global.fetch = jest.fn(() => Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      }));

      try {
        await processTextInput('test', mockUserId, 'test-api-key', 'voice');
      } catch (error) {
        // Expected to fail
      }

      const apiLog = insertedLogs.find(log => log.category === 'api');
      expect(apiLog).toBeDefined();
      expect(apiLog.metadata.response_status).toBe(500);
      expect(apiLog.metadata.response_ok).toBe(false);
    });

    it('should log product search API failures', async () => {
      // Mock Open Food Facts failure
      global.fetch = jest.fn(() => Promise.resolve({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable')
      }));

      await searchAllProducts('test', null);

      const errorLog = insertedLogs.find(
        log => log.level === 'error' && log.category === 'product_search'
      );

      expect(errorLog).toBeDefined();
      expect(errorLog.message).toContain('search failed');
      expect(errorLog.metadata.error_message).toBeDefined();
    });
  });

  describe('Session and User Tracking', () => {
    it('should include consistent session_id across multiple logs', async () => {
      const testSessionId = `session_${Date.now()}_test`;
      global.sessionId = testSessionId;

      await Logger.info('test1', 'Message 1', {}, mockUserId);
      await Logger.info('test2', 'Message 2', {}, mockUserId);

      expect(insertedLogs.length).toBe(2);
      expect(insertedLogs[0].session_id).toBe(testSessionId);
      expect(insertedLogs[1].session_id).toBe(testSessionId);
    });

    it('should include user_id in all logs within a flow', async () => {
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          content: [{
            text: JSON.stringify({
              event_type: 'food',
              event_data: { description: 'test' },
              confidence: 90
            })
          }]
        })
      }));

      await processTextInput('test', mockUserId, 'test-api-key', 'voice');

      // All logs should have the user_id
      const logsWithoutUserId = insertedLogs.filter(log => !log.user_id);
      expect(logsWithoutUserId.length).toBe(0);

      const logsWithUserId = insertedLogs.filter(log => log.user_id === mockUserId);
      expect(logsWithUserId.length).toBe(insertedLogs.length);
    });
  });

  describe('Log Levels', () => {
    it('should use correct log level for different scenarios', async () => {
      await Logger.debug('test', 'Debug message', {}, mockUserId);
      await Logger.info('test', 'Info message', {}, mockUserId);
      await Logger.warn('test', 'Warning message', {}, mockUserId);
      await Logger.error('test', 'Error message', {}, mockUserId);

      expect(insertedLogs[0].level).toBe('debug');
      expect(insertedLogs[1].level).toBe('info');
      expect(insertedLogs[2].level).toBe('warn');
      expect(insertedLogs[3].level).toBe('error');
    });

    it('should use error level for parsing failures', async () => {
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          content: [{ text: 'Invalid JSON' }]
        })
      }));

      try {
        await processTextInput('test', mockUserId, 'test-api-key', 'voice');
      } catch (error) {
        // Expected
      }

      const parsingErrorLog = insertedLogs.find(
        log => log.category === 'parsing' && log.level === 'error'
      );
      expect(parsingErrorLog).toBeDefined();
    });
  });

  describe('Metadata Completeness', () => {
    it('should include comprehensive metadata for voice processing', async () => {
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          content: [{
            text: JSON.stringify({
              event_type: 'food',
              event_data: { description: 'test' },
              confidence: 85
            })
          }]
        })
      }));

      await processTextInput('test input', mockUserId, 'test-api-key', 'voice');

      const startLog = insertedLogs.find(
        log => log.message === 'Starting text input processing'
      );

      expect(startLog.metadata).toMatchObject({
        input_text: 'test input',
        input_length: 10,
        capture_method: 'voice',
        has_transcription_metadata: false
      });
    });

    it('should include response preview in parsing logs', async () => {
      const longResponse = 'a'.repeat(1000);
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          content: [{
            text: JSON.stringify({
              event_type: 'food',
              event_data: { description: longResponse },
              confidence: 90
            })
          }]
        })
      }));

      await processTextInput('test', mockUserId, 'test-api-key', 'voice');

      const responseLog = insertedLogs.find(
        log => log.message === 'Received Claude API response'
      );

      expect(responseLog.metadata.response_preview).toBeDefined();
      expect(responseLog.metadata.response_preview.length).toBeLessThanOrEqual(500);
      expect(responseLog.metadata.response_length).toBeGreaterThan(500);
    });
  });
});
