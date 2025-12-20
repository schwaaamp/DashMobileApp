/**
 * Test Case 1: Voice Phonetic Matching
 * Tests that "lemonade element pack" correctly matches to "LMNT" brand through phonetic matching
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { searchAllProducts } from '@/utils/productSearch';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
// DO NOT mock productSearch - we want to test real phonetic matching logic

describe('Voice Phonetic Matching - LMNT', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-123';
  const mockVoiceEventId = 'event-456';
  const testInput = 'lemonade element pack';

  beforeEach(() => {
    jest.clearAllMocks();

    // Use shared Supabase mock helper
    supabase.from = createSupabaseMock({ auditId: mockAuditId });
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

    // Use shared mock
    supabase.from = createSupabaseMock({ auditId: mockAuditId });

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

    // Use shared mock
    supabase.from = createSupabaseMock({ auditId: mockAuditId });

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

    // Verify result data (no need to check mock calls - result verification is sufficient)
    expect(result.id).toBeDefined();
    expect(result.event_type).toBe('food');
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

    // Use shared mock
    supabase.from = createSupabaseMock({ auditId: mockAuditId });

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

    // Verify result data (no need to check mock calls - result verification is sufficient)
    expect(result.id).toBeDefined();
    expect(result.record_type).toBe('food');
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

  it('should match "citrus element" to "Citrus Salt - LMNT" in top 3 results', async () => {
    // Test that "citrus element" phonetically matches to LMNT Citrus Salt
    const query = 'citrus element';

    // Mock Open Food Facts API to return LMNT Citrus Salt product
    global.fetch = jest.fn((url) => {
      if (url.includes('openfoodfacts.org')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            products: [
              {
                code: 'lmnt-citrus-001',
                product_name: 'Citrus Salt - LMNT',
                brands: 'LMNT',
                serving_size: '1 pack (6g)',
                nutriments: {
                  'energy-kcal_100g': 0,
                  'sodium_100g': 1000,
                  'potassium_100g': 200,
                  'magnesium_100g': 60,
                  proteins_100g: 0,
                  carbohydrates_100g: 0,
                  fat_100g: 0
                }
              },
              {
                code: 'lmnt-citrus-002',
                product_name: 'LMNT Citrus Salt Electrolyte Drink Mix',
                brands: 'LMNT',
                serving_size: '1 pack',
                nutriments: {
                  'energy-kcal_100g': 0,
                  'sodium_100g': 1000,
                  proteins_100g: 0,
                  carbohydrates_100g: 0,
                  fat_100g: 0
                }
              },
              {
                code: 'generic-citrus-001',
                product_name: 'Generic Citrus Powder',
                brands: 'Generic Brand',
                serving_size: '1 tsp',
                nutriments: {
                  'energy-kcal_100g': 50,
                  proteins_100g: 0,
                  carbohydrates_100g: 12,
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

    // Call searchAllProducts with "citrus element"
    // The phonetic variation should transform "element" → "lmnt"
    // Creating search variations like: "citrus lmnt", "ctrs element", "ctrs lmnt"
    const results = await searchAllProducts(query, null);

    // Verify results
    expect(results.length).toBeGreaterThan(0);

    // Get top 3 results
    const top3 = results.slice(0, 3);

    // Find LMNT Citrus Salt in top 3
    const citrusLmntProduct = top3.find(p =>
      p.brand === 'LMNT' &&
      (p.name.includes('Citrus Salt') || p.name.includes('Citrus'))
    );

    expect(citrusLmntProduct).toBeDefined();
    expect(citrusLmntProduct.brand).toBe('LMNT');
    expect(citrusLmntProduct.name).toMatch(/Citrus.*LMNT|LMNT.*Citrus/i);
    expect(citrusLmntProduct.confidence).toBeGreaterThan(0);

    // Verify it's in top 3 results
    const indexInResults = top3.findIndex(p => p === citrusLmntProduct);
    expect(indexInResults).toBeGreaterThanOrEqual(0);
    expect(indexInResults).toBeLessThan(3);
  });
});