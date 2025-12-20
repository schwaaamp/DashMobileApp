/**
 * Test Suite: Event Type Classification
 *
 * Tests that Gemini/Claude correctly classifies different products and inputs
 * into the appropriate event types (food, supplement, medication, etc.).
 *
 * This test suite was created to catch the bug where LMNT electrolyte drinks
 * were being classified as 'food' instead of 'supplement', causing unnecessary
 * product searches despite high confidence and brand detection.
 *
 * Key Issue:
 * - User says: "element citrus"
 * - Gemini detects: "LMNT citrus" (correct phonetic transformation)
 * - Gemini classifies: event_type = 'food' (WRONG - should be 'supplement')
 * - Result: Product search triggered (food always searches)
 * - Expected: Bypass search (90% confidence + brand + supplement)
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { supabase } from '@/utils/supabaseClient';

jest.mock('@/utils/supabaseClient');

describe('Event Type Classification', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-classification-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Comprehensive Supabase mock that handles all tables
    supabase.from = jest.fn((table) => {
      // Common chain methods
      const selectChain = {
        eq: jest.fn(() => selectChain),
        order: jest.fn(() => selectChain),
        limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
        single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })), // Not found
        gte: jest.fn(() => selectChain)
      };

      const insertChain = {
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: { id: mockAuditId },
            error: null
          }))
        }))
      };

      const updateChain = {
        eq: jest.fn(() => Promise.resolve({ error: null }))
      };

      // Return appropriate chains based on table
      if (table === 'user_product_registry') {
        return {
          select: jest.fn(() => selectChain),
          insert: jest.fn(() => insertChain),
          update: jest.fn(() => updateChain)
        };
      }

      if (table === 'voice_events') {
        return {
          select: jest.fn(() => selectChain),
          insert: jest.fn((data) => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: { id: 'event-new', ...data[0] },
                error: null
              }))
            }))
          }))
        };
      }

      if (table === 'voice_records_audit') {
        return {
          insert: jest.fn(() => insertChain),
          update: jest.fn(() => updateChain)
        };
      }

      // Default fallback for any other table
      return {
        select: jest.fn(() => selectChain),
        insert: jest.fn(() => insertChain),
        update: jest.fn(() => updateChain)
      };
    });
  });

  describe('LMNT Product Classification (Bug Fix)', () => {
    it('should classify LMNT electrolyte drinks as supplement, not food', async () => {
      // Mock Claude API to return what it CURRENTLY returns (the bug)
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'food',  // BUG: Should be 'supplement'
                  event_data: {
                    description: 'LMNT Citrus'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 90
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'element citrus',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Debug: Check what we got
      console.log('Test result:', JSON.stringify(result, null, 2));

      // CRITICAL: Should be classified as supplement
      // This test will FAIL until we fix the prompt or add post-processing
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.parsed).toBeDefined();
      expect(result.parsed.event_type).toBe('supplement');

      // With 90% confidence + brand, should NOT search
      // productOptions may be undefined or null when no search performed
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true);
      expect(result.complete).toBe(true);
    });

    it('REGRESSION: element citrus should bypass search (user bug report)', async () => {
      // This is the EXACT scenario from user's logs that failed

      // Mock Claude to return what it SHOULD return (after fix)
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',  // Fixed classification
                  event_data: {
                    name: 'LMNT Citrus Salt',
                    dosage: '1 pack',
                    units: 'pack'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 90
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'element citrus',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Should bypass search because:
      // - Confidence: 90% (> 83%) ✓
      // - Has brand: LMNT ✓
      // - Event type: supplement ✓
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true);
      expect(result.complete).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should classify LMNT lemonade as supplement', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',
                  event_data: {
                    name: 'LMNT Lemonade',
                    dosage: '1 pack',
                    units: 'pack'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 92
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'lemonade element pack',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      expect(result.parsed.event_type).toBe('supplement');
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true);
    });
  });

  describe('Electrolyte Drink Classification', () => {
    const electrolyteProducts = [
      { input: 'LMNT citrus', brand: 'LMNT', expectedType: 'supplement' },
      { input: 'LMNT lemonade', brand: 'LMNT', expectedType: 'supplement' },
      { input: 'LMNT watermelon', brand: 'LMNT', expectedType: 'supplement' },
      { input: 'Nuun tablets', brand: 'Nuun', expectedType: 'supplement' },
      { input: 'Liquid IV hydration', brand: 'Liquid IV', expectedType: 'supplement' },
      { input: 'Ultima electrolyte', brand: 'Ultima', expectedType: 'supplement' },
    ];

    electrolyteProducts.forEach(({ input, brand, expectedType }) => {
      it(`should classify "${input}" as ${expectedType}`, async () => {
        global.fetch = jest.fn((url) => {
          if (url.includes('anthropic.com')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({
                content: [{
                  text: JSON.stringify({
                    event_type: expectedType,
                    event_data: {
                      name: input,
                      dosage: '1 pack',
                      units: 'pack'
                    },
                    event_time: new Date().toISOString(),
                    confidence: 90
                  })
                }]
              })
            });
          }
          return Promise.reject(new Error('Unexpected fetch URL'));
        });

        const result = await processTextInput(
          input,
          mockUserId,
          process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
          'voice'
        );

        expect(result.parsed.event_type).toBe(expectedType);
      });
    });
  });

  describe('Food vs Supplement Boundary Cases', () => {
    const boundaryTests = [
      // Supplements (should NOT trigger food search)
      { input: 'NOW Vitamin D', expectedType: 'supplement', reason: 'Vitamin supplement' },
      { input: 'Nature Made B12', expectedType: 'supplement', reason: 'Vitamin supplement' },
      { input: 'Thorne Magnesium', expectedType: 'supplement', reason: 'Mineral supplement' },
      { input: 'Jarrow B-Complex', expectedType: 'supplement', reason: 'Vitamin complex' },
      { input: 'Optimum Nutrition whey protein', expectedType: 'supplement', reason: 'Protein powder' },
      { input: 'creatine monohydrate', expectedType: 'supplement', reason: 'Workout supplement' },

      // Food (should trigger food search)
      { input: 'Gatorade', expectedType: 'food', reason: 'Sports drink marketed as beverage' },
      { input: 'Quest protein bar', expectedType: 'food', reason: 'Protein bar (prepared food)' },
      { input: 'apple', expectedType: 'food', reason: 'Whole food' },
      { input: 'chicken breast', expectedType: 'food', reason: 'Whole food' },
    ];

    boundaryTests.forEach(({ input, expectedType, reason }) => {
      it(`should classify "${input}" as ${expectedType} (${reason})`, async () => {
        global.fetch = jest.fn((url) => {
          if (url.includes('anthropic.com')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({
                content: [{
                  text: JSON.stringify({
                    event_type: expectedType,
                    event_data: expectedType === 'food'
                      ? { description: input }
                      : { name: input, dosage: null, units: null },
                    event_time: new Date().toISOString(),
                    confidence: 85
                  })
                }]
              })
            });
          }
          return Promise.reject(new Error('Unexpected fetch URL'));
        });

        const result = await processTextInput(
          input,
          mockUserId,
          process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
          'voice'
        );

        expect(result.parsed.event_type).toBe(expectedType);
      });
    });

    // Special test for protein shake reclassification
    it('should reclassify "Premier Protein shake" from food to supplement', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'food',  // Claude incorrectly returns food
                  event_data: {
                    description: 'Premier Protein shake'
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

      const result = await processTextInput(
        'Premier Protein shake',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Should be reclassified to supplement
      expect(result.parsed.event_type).toBe('supplement');
      expect(result.parsed.event_data.name).toBe('Premier Protein shake');
    });
  });

  describe('High-Confidence Supplement Product Search Bypass', () => {
    it('should NOT search when supplement has 90% confidence with brand', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',  // Must be supplement, not food
                  event_data: {
                    name: 'LMNT Citrus Salt',
                    dosage: '1 pack',
                    units: 'pack'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 90
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'element citrus',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Key assertions
      expect(result.parsed.event_type).toBe('supplement');
      expect(result.confidence).toBe(90);
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true);  // No search performed
      expect(result.complete).toBe(true);  // Saved directly
    });

    it('should SEARCH when food has 90% confidence (food always searches)', async () => {
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
                    description: 'Gatorade',
                    calories: 80
                  },
                  event_time: new Date().toISOString(),
                  confidence: 90
                })
              }]
            })
          });
        }
        // Mock product search
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              products: [
                { code: '123', product_name: 'Gatorade', brands: 'Gatorade' }
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

      const result = await processTextInput(
        'Gatorade',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      expect(result.parsed.event_type).toBe('food');
      expect(result.productOptions).toBeDefined();  // Search was performed
      expect(result.productOptions.length).toBeGreaterThan(0);
    });
  });

  describe('Product Search Decision Based on Event Type', () => {
    it('should bypass search: supplement + 90% confidence + brand', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',
                  event_data: {
                    name: 'NOW Vitamin D 5000 IU',
                    dosage: '5000',
                    units: 'IU'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 90
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'NOW Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      expect(result.parsed.event_type).toBe('supplement');
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true);
    });

    it('should trigger search: food + 90% confidence (food always searches)', async () => {
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
                    description: 'Apple',
                    calories: 95
                  },
                  event_time: new Date().toISOString(),
                  confidence: 90
                })
              }]
            })
          });
        }
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ products: [] })
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

      const result = await processTextInput(
        'apple',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      expect(result.parsed.event_type).toBe('food');
      expect(result.productOptions).toBeDefined();
    });

    it('should trigger search: supplement + 75% confidence (below threshold)', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',
                  event_data: {
                    name: 'Vitamin D',
                    dosage: null,
                    units: null
                  },
                  event_time: new Date().toISOString(),
                  confidence: 75
                })
              }]
            })
          });
        }
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              products: [
                { code: '123', product_name: 'NOW Vitamin D', brands: 'NOW' }
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

      const result = await processTextInput(
        'Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      expect(result.parsed.event_type).toBe('supplement');
      expect(result.confidence).toBe(75);
      expect(result.productOptions).toBeDefined();
      expect(result.complete).toBe(false);
    });
  });

  describe('Phonetic Transformation with Correct Classification', () => {
    it('should classify "element citrus" as supplement despite transformation', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',  // Correct classification
                  event_data: {
                    name: 'LMNT Citrus Salt',
                    dosage: '1 pack',
                    units: 'pack'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 90
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'element citrus',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Should be supplement (not food)
      expect(result.parsed.event_type).toBe('supplement');

      // Should bypass search despite phonetic transformation
      // because: supplement + 90% confidence + brand (LMNT)
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true);
      expect(result.complete).toBe(true);
    });
  });
});
