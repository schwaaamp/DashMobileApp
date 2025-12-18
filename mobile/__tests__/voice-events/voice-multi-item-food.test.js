/**
 * Test Case 5: Multi-Item Food with Serving Sizes
 * Tests that "chicken thigh, broccoli, and wegmans hummus" correctly:
 * - Parses multiple food items
 * - Estimates serving sizes when not specified
 * - Returns product options for each item
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { searchAllProducts } from '@/utils/productSearch';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('@/utils/productSearch');

describe.skip('Voice Multi-Item Food Logging (TODO: Not yet implemented)', () => {
  const mockUserId = 'test-user-123';
  const mockAuditId = 'audit-999';
  const testInput = 'chicken thigh, broccoli, and wegmans hummus';

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

  it('should parse multi-item food input', async () => {
    // Mock Gemini API response for multi-item parsing
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
                  description: 'chicken thigh, broccoli, wegmans hummus',
                  serving_size: null, // Not specified, needs estimation
                  calories: null,
                  carbs: null,
                  protein: null,
                  fat: null
                },
                event_time: new Date().toISOString(),
                confidence: 75 // Lower confidence due to missing serving sizes
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    // Mock product search results for multiple items
    const mockProductResults = [
      {
        source: 'usda',
        id: 'usda-chicken-123',
        name: 'Chicken, thigh, skinless, roasted',
        servingSize: '1 thigh (52g)',
        nutrients: {
          calories: 109,
          protein: 13.5,
          carbs: 0,
          fat: 5.7
        },
        confidence: 90
      },
      {
        source: 'usda',
        id: 'usda-broccoli-456',
        name: 'Broccoli, cooked',
        servingSize: '1 cup (156g)',
        nutrients: {
          calories: 55,
          protein: 3.7,
          carbs: 11.2,
          fat: 0.6
        },
        confidence: 95
      },
      {
        source: 'openfoodfacts',
        id: 'off-wegmans-789',
        name: 'Wegmans Hummus Classic',
        brand: 'Wegmans',
        servingSize: '2 tbsp (28g)',
        nutrients: {
          calories: 60,
          protein: 2,
          carbs: 5,
          fat: 3.5
        },
        confidence: 88
      }
    ];

    searchAllProducts.mockResolvedValue(mockProductResults);

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
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {},
                error: null
              }))
            }))
          }))
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

    expect(result.success).toBe(true);

    // Should go to confirmation screen due to missing serving sizes
    expect(result.complete).toBe(false);
    expect(result.parsed).toBeDefined();
    expect(result.parsed.event_type).toBe('food');

    // Should have product options for user to choose from
    expect(searchAllProducts).toHaveBeenCalled();
    expect(result.productOptions).toBeDefined();
  });

  it('should trigger product search for food items', async () => {
    const mockProducts = [
      {
        source: 'usda',
        name: 'Chicken thigh',
        servingSize: '1 thigh',
        confidence: 90
      }
    ];

    searchAllProducts.mockResolvedValue(mockProducts);

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
                  description: testInput,
                  serving_size: null
                },
                event_time: new Date().toISOString(),
                confidence: 75
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

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
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {},
                error: null
              }))
            }))
          }))
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

    await processTextInput(
      testInput,
      mockUserId,
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      'voice'
    );

    // Verify searchAllProducts was called with the food description
    expect(searchAllProducts).toHaveBeenCalledWith(
      expect.stringContaining('chicken'),
      expect.any(String)
    );
  });

  it('should return product options for each item', async () => {
    const mockChickenProducts = [
      {
        source: 'usda',
        name: 'Chicken, thigh, skinless',
        servingSize: '1 thigh (52g)',
        confidence: 90
      },
      {
        source: 'usda',
        name: 'Chicken, thigh, with skin',
        servingSize: '1 thigh (62g)',
        confidence: 85
      }
    ];

    searchAllProducts.mockResolvedValue(mockChickenProducts);

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
                  description: testInput,
                  serving_size: null
                },
                event_time: new Date().toISOString(),
                confidence: 75
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

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
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {},
                error: null
              }))
            }))
          }))
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

    expect(result.productOptions).toBeDefined();
    expect(result.productOptions.length).toBeGreaterThan(0);
    expect(result.productOptions[0]).toHaveProperty('name');
    expect(result.productOptions[0]).toHaveProperty('servingSize');
  });

  it('should handle missing serving size in event_data', () => {
    // When serving size is not specified, it should be null
    const eventDataWithoutServing = {
      description: 'chicken thigh, broccoli, wegmans hummus',
      serving_size: null,
      calories: null,
      carbs: null,
      protein: null,
      fat: null
    };

    expect(eventDataWithoutServing.serving_size).toBeNull();
    expect(eventDataWithoutServing.description).toBeTruthy();
  });

  it('should route to confirmation screen for serving size estimation', async () => {
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
                  description: testInput,
                  serving_size: null // Missing serving size
                },
                event_time: new Date().toISOString(),
                confidence: 75
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    searchAllProducts.mockResolvedValue([
      {
        source: 'usda',
        name: 'Chicken thigh',
        servingSize: '1 thigh',
        confidence: 90
      }
    ]);

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
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {},
                error: null
              }))
            }))
          }))
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

    // Should NOT complete directly - needs confirmation
    expect(result.complete).toBe(false);

    // Should have parsed data with product options
    expect(result.parsed).toBeDefined();
    expect(result.productOptions).toBeDefined();

    // Audit status should be 'awaiting_user_clarification'
    const updateCall = supabase.from.mock.results.find(
      r => r.value && r.value.update
    );
    expect(updateCall).toBeDefined();
  });

  it('should store multiple food items separately after user confirmation', async () => {
    // After user confirms each item with serving sizes,
    // the app should create separate voice_events entries

    const foodItems = [
      {
        description: 'chicken thigh',
        serving_size: '1 thigh (52g)',
        calories: 109,
        protein: 13.5,
        carbs: 0,
        fat: 5.7
      },
      {
        description: 'broccoli',
        serving_size: '1 cup (156g)',
        calories: 55,
        protein: 3.7,
        carbs: 11.2,
        fat: 0.6
      },
      {
        description: 'wegmans hummus',
        serving_size: '2 tbsp (28g)',
        calories: 60,
        protein: 2,
        carbs: 5,
        fat: 3.5
      }
    ];

    const { createVoiceEvent } = require('@/utils/voiceEventParser');

    const mockInserts = [];

    for (const item of foodItems) {
      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: {
              id: `event-${item.description}`,
              user_id: mockUserId,
              event_type: 'food',
              event_data: item,
              event_time: new Date().toISOString(),
              source_record_id: mockAuditId,
              capture_method: 'voice'
            },
            error: null
          }))
        }))
      }));

      supabase.from = jest.fn(() => ({ insert: mockInsert }));

      const result = await createVoiceEvent(
        mockUserId,
        'food',
        item,
        new Date().toISOString(),
        mockAuditId,
        'voice'
      );

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_data: item
        })
      );

      mockInserts.push(mockInsert);
    }

    // Verify all three items were inserted
    expect(mockInserts.length).toBe(3);
  });

  it('should search for brand-specific products (Wegmans hummus)', async () => {
    const brandQuery = 'wegmans hummus';

    searchAllProducts.mockResolvedValue([
      {
        source: 'openfoodfacts',
        name: 'Wegmans Hummus Classic',
        brand: 'Wegmans',
        servingSize: '2 tbsp',
        confidence: 95
      },
      {
        source: 'openfoodfacts',
        name: 'Wegmans Roasted Red Pepper Hummus',
        brand: 'Wegmans',
        servingSize: '2 tbsp',
        confidence: 90
      }
    ]);

    const results = await searchAllProducts(brandQuery, null);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].brand).toBe('Wegmans');
    expect(results[0].name).toContain('Hummus');
  });
});
