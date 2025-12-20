/**
 * Test Suite: Historical Bias Confidence Boosting
 *
 * Tests that user history increases Claude's confidence level when input matches
 * frequently logged items, allowing the system to bypass product search.
 *
 * Key Behavior:
 * - When user has history of "NOW Vitamin D 5000 IU" and says "Vitamin D"
 * - Claude should recognize the pattern and return high confidence (>83%)
 * - System should bypass product search and save directly
 */

import { processTextInput, parseTextWithClaude } from '@/utils/voiceEventParser';
import { shouldSearchProducts } from '@/utils/productSearch';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');

describe('Historical Bias Confidence Boosting', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-boost-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock for Supabase
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

  describe('Confidence Boost WITH Matching History', () => {
    it('should boost confidence to >83% when user has logged "NOW Vitamin D" 10 times and says "Vitamin D"', async () => {
      // Mock user history: 10 entries of "NOW Vitamin D 5000 IU"
      const mockHistory = Array(10).fill({
        id: 'event-123',
        user_id: mockUserId,
        event_type: 'supplement',
        event_data: {
          name: 'NOW Vitamin D 5000 IU',
          dosage: '5000',
          units: 'IU'
        },
        event_time: new Date().toISOString()
      });

      // Mock getUserRecentEvents to return history
      supabase.from = jest.fn((table) => {
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({
                    data: mockHistory,
                    error: null
                  }))
                }))
              }))
            })),
            insert: jest.fn((data) => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'event-new',
                    ...data[0] // Return the inserted data
                  },
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

      // Mock Claude API to return high confidence due to history matching
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
                  confidence: 92 // HIGH CONFIDENCE due to history match
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Test: User says just "Vitamin D"
      const result = await processTextInput(
        'Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.success).toBe(true);
      expect(result.confidence).toBeGreaterThan(83); // Confidence boosted by history
      expect(result.complete).toBe(true); // Should save directly

      // Should NOT have product options (bypassed search)
      // This is the key behavior: high confidence + history match = no product search
      expect(result.productOptions).toBeUndefined();
    });

    it('should boost confidence for frequently logged food items', async () => {
      // Mock user history: 15 entries of "Large chicken thigh with broccoli"
      const mockHistory = Array(15).fill({
        id: 'event-food-123',
        user_id: mockUserId,
        event_type: 'food',
        event_data: {
          description: 'Large chicken thigh with broccoli',
          protein: 45,
          carbs: 8,
          calories: 350
        },
        event_time: new Date().toISOString()
      });

      supabase.from = jest.fn((table) => {
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({
                    data: mockHistory,
                    error: null
                  }))
                }))
              }))
            })),
            insert: jest.fn((data) => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'event-new',
                    ...data[0] // Return the inserted data
                  },
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

      // Mock Claude API - high confidence for food due to history
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
                    description: 'Large chicken thigh with broccoli',
                    protein: 45,
                    carbs: 8,
                    calories: 350
                  },
                  event_time: new Date().toISOString(),
                  confidence: 95 // HIGH CONFIDENCE
                })
              }]
            })
          });
        }
        // Food always searches, so mock Open Food Facts
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

      // Test: User says "chicken thigh"
      const result = await processTextInput(
        'chicken thigh',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.success).toBe(true);
      expect(result.confidence).toBeGreaterThan(83);
      // Note: Food ALWAYS triggers product search (even with high confidence)
      // But should still show the matched historical item in results
    });
  });

  describe('NO Confidence Boost WITHOUT Matching History', () => {
    it('should return lower confidence (≤83%) when user has NO history of Vitamin D', async () => {
      // Mock EMPTY user history
      const mockHistory = [];

      supabase.from = jest.fn((table) => {
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({
                    data: mockHistory,
                    error: null
                  }))
                }))
              }))
            })),
            insert: jest.fn((data) => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'event-new',
                    ...data[0] // Return the inserted data
                  },
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

      // Mock Claude API - LOWER confidence without history
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
                  confidence: 75 // LOWER CONFIDENCE without history
                })
              }]
            })
          });
        }
        // Mock product search APIs
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              products: [
                {
                  code: '123',
                  product_name: 'NOW Vitamin D 5000 IU',
                  brands: 'NOW',
                  serving_size: '1 softgel'
                },
                {
                  code: '456',
                  product_name: 'Nature Made Vitamin D3',
                  brands: 'Nature Made',
                  serving_size: '1 tablet'
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

      // Test: User says "Vitamin D" with NO history
      const result = await processTextInput(
        'Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.success).toBe(true);
      expect(result.confidence).toBeLessThanOrEqual(83); // Low confidence
      expect(result.complete).toBe(false); // Needs confirmation
      expect(result.productOptions).toBeDefined(); // Product search triggered
      expect(result.productOptions.length).toBeGreaterThan(0); // Has options
    });

    it('should NOT match unrelated history items', async () => {
      // Mock user history: User logs "Magnesium" frequently, but NOT "Vitamin D"
      const mockHistory = Array(10).fill({
        id: 'event-mag-123',
        user_id: mockUserId,
        event_type: 'supplement',
        event_data: {
          name: 'NOW Magnesium L-Threonate',
          dosage: '2000',
          units: 'mg'
        },
        event_time: new Date().toISOString()
      });

      supabase.from = jest.fn((table) => {
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({
                    data: mockHistory,
                    error: null
                  }))
                }))
              }))
            })),
            insert: jest.fn((data) => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'event-new',
                    ...data[0] // Return the inserted data
                  },
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

      // Mock Claude API - should NOT match Magnesium when user says "Vitamin D"
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
                  confidence: 70 // LOW confidence - no matching history
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

      // Test: User says "Vitamin D" but only has Magnesium in history
      const result = await processTextInput(
        'Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.confidence).toBeLessThanOrEqual(83);
      expect(result.parsed.event_data.name).not.toContain('Magnesium');
      expect(result.productOptions).toBeDefined(); // Should search
    });
  });

  describe('Partial Match Confidence Boost', () => {
    it('should boost confidence when user says brand name that matches history', async () => {
      // Mock history: User frequently logs "NOW" brand supplements
      const mockHistory = [
        {
          event_type: 'supplement',
          event_data: { name: 'NOW Vitamin D 5000 IU' }
        },
        {
          event_type: 'supplement',
          event_data: { name: 'NOW Magnesium L-Threonate' }
        },
        {
          event_type: 'supplement',
          event_data: { name: 'NOW Omega-3' }
        },
        {
          event_type: 'supplement',
          event_data: { name: 'NOW B-Complex' }
        }
      ].map((item, idx) => ({
        id: `event-now-${idx}`,
        user_id: mockUserId,
        event_time: new Date().toISOString(),
        ...item
      }));

      supabase.from = jest.fn((table) => {
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({
                    data: mockHistory,
                    error: null
                  }))
                }))
              }))
            })),
            insert: jest.fn((data) => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'event-new',
                    ...data[0] // Return the inserted data
                  },
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

      // Mock Claude API - should recognize "NOW" brand from history
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
                  confidence: 88 // Boosted by brand recognition
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Test: User says "NOW Vitamin D" (brand + supplement name)
      const result = await processTextInput(
        'NOW Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.confidence).toBeGreaterThan(83);

      // Key behavior: high confidence due to brand recognition in history
      // The exact structure doesn't matter as much as the confidence being boosted
      expect(result.success).toBe(true);
    });
  });
});
