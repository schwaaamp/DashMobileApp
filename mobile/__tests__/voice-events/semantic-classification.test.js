/**
 * Semantic Classification Tests
 * Tests that semantic scoring catches supplements that AI misclassified as food
 * Focus: Supplements identified by linguistic patterns, not hard-coded brands
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');

describe('Semantic Classification - Supplement Detection', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';

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
            data: { id: 'audit-123' },
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

  describe('Brand-Specific Detection (Pattern Matching)', () => {
    it('should detect LMNT when Gemini already converted "element" to "LMNT"', async () => {
      // Simulate Gemini voice flow where it already converted "element" -> "LMNT"
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'food',  // AI incorrectly classifies as food
                  event_data: {
                    description: 'LMNT lemonade'  // Already converted
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
        'LMNT lemonade',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Should be reclassified to supplement via pattern matching
      expect(result.parsed.event_type).toBe('supplement');
      expect(result.parsed.event_data.name).toContain('LMNT');
      expect(result.complete).toBe(true);
    });

    it('should detect "element citrus" as LMNT supplement', async () => {
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
                    description: 'element citrus'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 88
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

      expect(result.parsed.event_type).toBe('supplement');
      expect(result.parsed.event_data.name).toContain('LMNT');
    });
  });

  describe('Semantic Detection (No Brand Patterns)', () => {
    it('should detect "whey protein shake" as supplement via semantic scoring', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'food',  // AI says food
                  event_data: {
                    description: 'whey protein shake'
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
        'whey protein shake',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Should be reclassified via semantic scoring (protein keyword + shake form factor)
      expect(result.parsed.event_type).toBe('supplement');
      expect(result.parsed.event_data.name).toBe('whey protein shake');
    });

    it('should detect "5g creatine" as supplement via dosage indicator', async () => {
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
                    description: '5g creatine'
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
        '5g creatine',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Semantic score: creatine keyword (0.5) + dosage (0.3) = 0.8 >= 0.7
      expect(result.parsed.event_type).toBe('supplement');
    });

    it('should detect "vitamin D capsules" as supplement via form factor', async () => {
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
                    description: 'vitamin D capsules'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 80
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'vitamin D capsules',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Semantic score: vitamin keyword (0.5) + capsules form (0.2) = 0.7 >= 0.7
      expect(result.parsed.event_type).toBe('supplement');
    });

    it('should detect "magnesium powder" as supplement', async () => {
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
                    description: 'magnesium powder'
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
        'magnesium powder',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Semantic score: magnesium keyword (0.5) + powder form (0.2) = 0.7 >= 0.7
      expect(result.parsed.event_type).toBe('supplement');
    });

    it('should detect "electrolyte drink mix" as supplement', async () => {
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
                    description: 'electrolyte drink mix'
                  },
                  event_time: new Date().toISOString(),
                  confidence: 88
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'electrolyte drink mix',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Semantic score: electrolyte keyword (0.5) + drink mix form (0.2) = 0.7 >= 0.7
      expect(result.parsed.event_type).toBe('supplement');
    });
  });

  describe('Food Items (Should NOT Reclassify)', () => {
    it('should keep "apple" as food (low semantic score)', async () => {
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
                    description: 'apple',
                    calories: 95,
                    carbs: 25,
                    protein: 0,
                    fat: 0
                  },
                  event_time: new Date().toISOString(),
                  confidence: 95
                })
              }]
            })
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

      // Semantic score: 0 (no keywords, no dosage, no form factor) < 0.7
      expect(result.parsed.event_type).toBe('food');
    });

    it('should keep "chicken breast" as food', async () => {
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
                    description: 'chicken breast',
                    calories: 165,
                    carbs: 0,
                    protein: 31,
                    fat: 3.6
                  },
                  event_time: new Date().toISOString(),
                  confidence: 98
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'chicken breast',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Even though it has "protein", it's not "protein powder/shake" pattern
      expect(result.parsed.event_type).toBe('food');
    });

    it('should keep "orange juice" as food', async () => {
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
                    description: 'orange juice',
                    calories: 112,
                    carbs: 26,
                    protein: 2,
                    fat: 0
                  },
                  event_time: new Date().toISOString(),
                  confidence: 95
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'orange juice',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      expect(result.parsed.event_type).toBe('food');
    });
  });

  describe('Scoring Threshold Validation', () => {
    it('should reclassify when semantic score >= 0.7', async () => {
      // Test case with exactly 0.7 score: vitamin (0.5) + capsule (0.2)
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
                    description: 'vitamin C capsule'
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
        'vitamin C capsule',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      expect(result.parsed.event_type).toBe('supplement');
    });

    it('should NOT reclassify when semantic score < 0.7', async () => {
      // Test case with low score: just "powder" (0.2) without supplement keywords
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
                    description: 'cocoa powder'
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
        'cocoa powder',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Score: powder (0.2) < 0.7 threshold
      expect(result.parsed.event_type).toBe('food');
    });
  });
});
