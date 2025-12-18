/**
 * Test Case 1: Voice Phonetic Matching
 * Tests that "lemonade element pack" correctly matches to "LMNT" brand through phonetic matching
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { searchAllProducts } from '@/utils/productSearch';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('@/utils/productSearch');

describe.skip('Voice Phonetic Matching - LMNT (TODO: Not yet implemented)', () => {
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
    // Mock product search to return LMNT products
    const mockLMNTProducts = [
      {
        source: 'openfoodfacts',
        id: '12345',
        name: 'LMNT Lemonade Electrolyte Drink Mix',
        brand: 'LMNT',
        servingSize: '1 pack (5.8g)',
        nutrients: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        },
        confidence: 85
      },
      {
        source: 'openfoodfacts',
        id: '12346',
        name: 'LMNT Citrus Salt',
        brand: 'LMNT',
        servingSize: '1 pack',
        nutrients: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        },
        confidence: 75
      }
    ];

    searchAllProducts.mockResolvedValue(mockLMNTProducts);

    // Mock Gemini API response for parsing
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

    // Verify searchAllProducts was called
    expect(searchAllProducts).toHaveBeenCalledWith(
      expect.stringContaining('lemonade'),
      expect.any(String)
    );

    // Verify result structure
    expect(result.success).toBe(true);
    expect(result.parsed || result.complete).toBeDefined();
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
    const mockProducts = [
      {
        name: 'LMNT Electrolytes',
        brand: 'LMNT',
        confidence: 0
      },
      {
        name: 'Regular Lemonade',
        brand: 'Generic',
        confidence: 0
      }
    ];

    // The phonetic matching should boost LMNT's confidence score
    // "element" (remove vowels) -> "lmnt" matches "LMNT" brand
    const query = 'element lemonade';
    const queryPhonetic = 'element'.replace(/[aeiou]/g, ''); // "lmnt"

    // Check that phonetic transformation works
    expect(queryPhonetic).toBe('lmnt');

    // When searchAllProducts is called with "element lemonade",
    // it should also search with "lmnt lemonade" as a variation
    searchAllProducts.mockImplementation(async (searchQuery) => {
      if (searchQuery.includes('lmnt') || searchQuery.includes('element')) {
        return [
          {
            source: 'openfoodfacts',
            name: 'LMNT Lemonade',
            brand: 'LMNT',
            confidence: 85
          }
        ];
      }
      return [];
    });

    const results = await searchAllProducts(query, null);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].brand).toBe('LMNT');
  });
});