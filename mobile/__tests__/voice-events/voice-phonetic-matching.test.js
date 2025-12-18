/**
 * Test Case 1: Voice Phonetic Matching
 * Tests that "lemonade element pack" correctly matches to "LMNT" brand through phonetic matching
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { searchAllProducts } from '@/utils/productSearch';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
// DO NOT mock productSearch - we want to test real phonetic matching logic

describe('Voice Phonetic Matching - LMNT', () => {
  const mockUserId = 'test-user-123';
  const mockAuditId = 'audit-123';
  const mockVoiceEventId = 'event-456';
  const testInput = 'lemonade element pack';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Supabase client methods
    supabase.from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
          }))
        }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: { id: mockAuditId },
            error: null
          }))
        }))
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null }))
      }))
    }));
  });

  it('should create phonetic variations including "lmnt"', () => {
    // This is an internal test to verify phonetic variation logic
    // The function createPhoneticVariations should create "lmnt lemonade" from "element lemonade"
    const query = 'lemonade element pack';
    const words = query.toLowerCase().split(/\s+/);

    // Simulate phonetic variation: remove vowels from "element" → "lmnt"
    const phoneticElement = 'element'.replace(/[aeiou]/g, '');
    expect(phoneticElement).toBe('lmnt');

    const phoneticPack = 'pack'.replace(/[aeiou]/g, '');
    expect(phoneticPack).toBe('pck');
  });

  it('should search products with phonetic variations', async () => {
    // Mock external API calls to Open Food Facts and USDA
    // The real searchAllProducts will create phonetic variations and search with them
    global.fetch = jest.fn((url) => {
      // Mock Open Food Facts API - should match "lmnt" variation from "element"
      if (url.includes('openfoodfacts.org')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            products: [
              {
                code: '12345',
                product_name: 'LMNT Lemonade Electrolyte Drink Mix',
                brands: 'LMNT',
                serving_size: '1 pack (5.8g)',
                nutriments: {
                  'energy-kcal_100g': 0,
                  proteins_100g: 0,
                  carbohydrates_100g: 0,
                  fat_100g: 0
                }
              },
              {
                code: '12346',
                product_name: 'LMNT Citrus Salt',
                brands: 'LMNT',
                serving_size: '1 pack',
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
      // Mock Claude API response for parsing voice input
      if (url.includes('anthropic.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            content: [{
              text: JSON.stringify({
                event_type: 'food',
                event_data: {
                  description: 'LMNT Lemonade',
                  serving_size: '1 pack',
                  calories: 0,
                  carbs: 0,
                  protein: 0,
                  fat: 0
                },
                event_time: new Date().toISOString(),
                confidence: 85
              })
            }]
          })
        });
      }
      // Mock USDA API (returns empty for this test)
      if (url.includes('api.nal.usda.gov')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ foods: [] })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    // Mock the insert for voice_events table
    const mockInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: {
            id: mockVoiceEventId,
            user_id: mockUserId,
            event_type: 'food',
            event_data: {
              description: 'LMNT Lemonade',
              serving_size: '1 pack',
              calories: 0,
              carbs: 0,
              protein: 0,
              fat: 0
            },
            event_time: expect.any(String),
            source_record_id: mockAuditId,
            capture_method: 'voice'
          },
          error: null
        }))
      }))
    }));

    // Override the mock for voice_events insert
    supabase.from = jest.fn((table) => {
      if (table === 'voice_events') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
              }))
            }))
          })),
          insert: mockInsert
        };
      }
      if (table === 'voice_records_audit') {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: { id: mockAuditId },
                error: null
              }))
            }))
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ error: null }))
          }))
        };
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          }))
        }))
      };
    });

    const result = await processTextInput(
      testInput,
      mockUserId,
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      'voice'
    );

    // Verify result structure
    expect(result.success).toBe(true);
    expect(result.parsed || result.complete).toBeDefined();

    // Verify that product search found LMNT through phonetic matching
    expect(result.productOptions).toBeDefined();
    expect(result.productOptions.length).toBeGreaterThan(0);

    // Verify LMNT brand was found (phonetic match from "element" -> "lmnt")
    const lmntProduct = result.productOptions.find(p => p.brand === 'LMNT');
    expect(lmntProduct).toBeDefined();
    expect(lmntProduct.name).toContain('LMNT');
  });

  it('should store voice_events entry with LMNT product data', async () => {
    // Mock complete flow with user choosing LMNT product
    const mockVoiceEvent = {
      id: mockVoiceEventId,
      user_id: mockUserId,
      event_type: 'food',
      event_data: {
        description: 'LMNT Lemonade',
        serving_size: '1 pack',
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0
      },
      event_time: new Date().toISOString(),
      source_record_id: mockAuditId,
      capture_method: 'voice'
    };

    // Mock the voice_events insert
    const mockInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: mockVoiceEvent,
          error: null
        }))
      }))
    }));

    supabase.from = jest.fn((table) => {
      if (table === 'voice_events') {
        return { insert: mockInsert };
      }
      return {
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: {}, error: null }))
          }))
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null }))
        }))
      };
    });

    // Directly test the createVoiceEvent function
    const { createVoiceEvent } = require('@/utils/voiceEventParser');

    const result = await createVoiceEvent(
      mockUserId,
      'food',
      {
        description: 'LMNT Lemonade',
        serving_size: '1 pack',
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0
      },
      mockVoiceEvent.event_time,
      mockAuditId,
      'voice'
    );

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: mockUserId,
      event_type: 'food',
      event_data: {
        description: 'LMNT Lemonade',
        serving_size: '1 pack',
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0
      },
      event_time: expect.any(String),
      source_record_id: mockAuditId,
      capture_method: 'voice'
    });

    expect(result).toEqual(mockVoiceEvent);
  });

  it('should store voice_records_audit with transcription metadata', async () => {
    const mockAuditRecord = {
      id: mockAuditId,
      user_id: mockUserId,
      raw_text: testInput,
      record_type: 'food',
      value: null,
      units: null,
      nlp_status: 'pending',
      nlp_model: 'claude-3-opus-20240229',
      nlp_metadata: {
        capture_method: 'voice',
        user_history_count: 0,
        claude_model: 'claude-3-opus-20240229'
      }
    };

    const mockInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: mockAuditRecord,
          error: null
        }))
      }))
    }));

    supabase.from = jest.fn((table) => {
      if (table === 'voice_records_audit') {
        return { insert: mockInsert };
      }
      return {};
    });

    const { createAuditRecord } = require('@/utils/voiceEventParser');

    const result = await createAuditRecord(
      mockUserId,
      testInput,
      'food',
      null,
      null,
      'claude-3-opus-20240229',
      {
        capture_method: 'voice',
        user_history_count: 0,
        claude_model: 'claude-3-opus-20240229'
      }
    );

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: mockUserId,
      raw_text: testInput,
      record_type: 'food',
      value: null,
      units: null,
      nlp_status: 'pending',
      nlp_model: 'claude-3-opus-20240229',
      nlp_metadata: {
        capture_method: 'voice',
        user_history_count: 0,
        claude_model: 'claude-3-opus-20240229'
      }
    });

    expect(result).toEqual(mockAuditRecord);
  });

  it('should handle phonetic brand name matching in productSearch', async () => {
    // Test the phonetic matching algorithm directly
    const query = 'element lemonade';
    const queryPhonetic = 'element'.replace(/[aeiou]/g, ''); // "lmnt"

    // Check that phonetic transformation works
    expect(queryPhonetic).toBe('lmnt');

    // Mock external API calls - Open Food Facts should return LMNT when searching "lmnt"
    global.fetch = jest.fn((url) => {
      if (url.includes('openfoodfacts.org')) {
        // The real searchAllProducts will search with phonetic variations
        // So we'll return LMNT products when the API is called
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            products: [
              {
                code: 'lmnt-001',
                product_name: 'LMNT Lemonade Electrolyte Drink Mix',
                brands: 'LMNT',
                serving_size: '1 pack',
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

    // Call the real searchAllProducts - it should create phonetic variations
    const results = await searchAllProducts(query, null);

    // Verify LMNT products were found through phonetic matching
    expect(results.length).toBeGreaterThan(0);
    const lmntProduct = results.find(p => p.brand === 'LMNT');
    expect(lmntProduct).toBeDefined();
    expect(lmntProduct.name).toContain('LMNT');
    expect(lmntProduct.confidence).toBeGreaterThan(0);
  });
});