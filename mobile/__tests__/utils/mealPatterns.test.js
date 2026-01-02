/**
 * Meal Pattern Detection Tests
 *
 * Tests for the meal template learning system that detects
 * recurring patterns from voice_events data.
 */

// Mock expo-file-system/legacy
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' }
}));

// Mock Supabase
jest.mock('../../src/utils/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(() => Promise.resolve({}))
  }
}));

import {
  generateMealFingerprint,
  calculatePatternSimilarity,
  groupEventsIntoSessions,
  extractItemFromEvent,
  detectMealPatterns,
  checkForPatternMatch,
  createTemplateFromPattern
} from '../../src/utils/mealPatterns';
import { supabase } from '../../src/utils/supabaseClient';

describe('Meal Pattern Detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateMealFingerprint', () => {
    it('should create fingerprint from product_ids when available', () => {
      const items = [
        { product_id: 'uuid-123', name: 'Vitamin D' },
        { product_id: 'uuid-456', name: 'Omega-3' },
        { product_id: 'uuid-789', name: 'Magtein' }
      ];

      const fingerprint = generateMealFingerprint(items);

      // Should be sorted alphabetically
      expect(fingerprint).toBe('uuid-123|uuid-456|uuid-789');
    });

    it('should fall back to normalized name when no product_id', () => {
      const items = [
        { product_id: null, name: 'Vitamin D3' },
        { product_id: null, name: 'Omega-3 Fish Oil' }
      ];

      const fingerprint = generateMealFingerprint(items);

      // Normalized and sorted
      expect(fingerprint).toBe('omega 3 fish oil|vitamin d3');
    });

    it('should handle mixed product_ids and names', () => {
      const items = [
        { product_id: 'uuid-123', name: 'Vitamin D' },
        { product_id: null, name: 'Generic Supplement' }
      ];

      const fingerprint = generateMealFingerprint(items);

      expect(fingerprint).toBe('generic supplement|uuid-123');
    });

    it('should return empty string for empty or null input', () => {
      expect(generateMealFingerprint([])).toBe('');
      expect(generateMealFingerprint(null)).toBe('');
      expect(generateMealFingerprint(undefined)).toBe('');
    });

    it('should filter out items with empty names and no product_id', () => {
      const items = [
        { product_id: 'uuid-123', name: 'Vitamin D' },
        { product_id: null, name: '' },
        { product_id: null, name: null }
      ];

      const fingerprint = generateMealFingerprint(items);

      expect(fingerprint).toBe('uuid-123');
    });
  });

  describe('calculatePatternSimilarity', () => {
    it('should return 1.0 for identical fingerprints', () => {
      const fp1 = 'uuid-123|uuid-456|uuid-789';
      const fp2 = 'uuid-123|uuid-456|uuid-789';

      expect(calculatePatternSimilarity(fp1, fp2)).toBe(1);
    });

    it('should return 0 for completely different fingerprints', () => {
      const fp1 = 'uuid-111|uuid-222';
      const fp2 = 'uuid-333|uuid-444';

      expect(calculatePatternSimilarity(fp1, fp2)).toBe(0);
    });

    it('should calculate correct similarity for partial matches', () => {
      // 4 items in template, 3 matching = 3/5 = 0.6 (union is 5)
      const fp1 = 'a|b|c|d';
      const fp2 = 'a|b|c|e';

      const similarity = calculatePatternSimilarity(fp1, fp2);

      // intersection: a, b, c (3)
      // union: a, b, c, d, e (5)
      // 3/5 = 0.6
      expect(similarity).toBeCloseTo(0.6, 2);
    });

    it('should return 0.75 when 3 of 4 items match exactly', () => {
      const template = 'a|b|c|d';
      const current = 'a|b|c';

      const similarity = calculatePatternSimilarity(template, current);

      // intersection: 3, union: 4
      expect(similarity).toBe(0.75);
    });

    it('should handle empty fingerprints', () => {
      expect(calculatePatternSimilarity('', 'a|b')).toBe(0);
      expect(calculatePatternSimilarity('a|b', '')).toBe(0);
      expect(calculatePatternSimilarity('', '')).toBe(0);
      expect(calculatePatternSimilarity(null, 'a|b')).toBe(0);
    });
  });

  describe('extractItemFromEvent', () => {
    it('should extract supplement event data correctly', () => {
      const event = {
        id: 'event-123',
        event_type: 'supplement',
        event_data: { name: 'Vitamin D3', dosage: 5000, units: 'IU' },
        product_catalog_id: 'catalog-uuid-123'
      };

      const item = extractItemFromEvent(event);

      expect(item).toEqual({
        product_id: 'catalog-uuid-123',
        name: 'Vitamin D3',
        event_type: 'supplement',
        calories: null,
        dosage: 5000,
        units: 'IU'
      });
    });

    it('should extract food event data correctly', () => {
      const event = {
        id: 'event-456',
        event_type: 'food',
        event_data: { description: 'Oatmeal with blueberries', calories: 250 },
        product_catalog_id: null
      };

      const item = extractItemFromEvent(event);

      expect(item).toEqual({
        product_id: null,
        name: 'Oatmeal with blueberries',
        event_type: 'food',
        calories: 250,
        dosage: null,
        units: null
      });
    });

    it('should handle medication events', () => {
      const event = {
        id: 'event-789',
        event_type: 'medication',
        event_data: { name: 'Ibuprofen', dosage: 200, units: 'mg' },
        product_catalog_id: 'med-uuid'
      };

      const item = extractItemFromEvent(event);

      expect(item.name).toBe('Ibuprofen');
      expect(item.event_type).toBe('medication');
      expect(item.dosage).toBe(200);
    });

    it('should handle events with missing data gracefully', () => {
      const event = {
        id: 'event-empty',
        event_type: 'supplement',
        event_data: {},
        product_catalog_id: null
      };

      const item = extractItemFromEvent(event);

      expect(item.name).toBe('');
      expect(item.product_id).toBeNull();
    });
  });

  describe('groupEventsIntoSessions', () => {
    it('should group events within time window', () => {
      const events = [
        { id: '1', event_time: '2025-01-15T08:00:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' } },
        { id: '2', event_time: '2025-01-15T08:05:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' } },
        { id: '3', event_time: '2025-01-15T08:10:00Z', event_type: 'supplement', event_data: { name: 'Magtein' } }
      ];

      const sessions = groupEventsIntoSessions(events, 30);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].items).toHaveLength(3);
    });

    it('should create separate sessions for events outside time window', () => {
      const events = [
        { id: '1', event_time: '2025-01-15T08:00:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' } },
        { id: '2', event_time: '2025-01-15T08:05:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' } },
        // 2 hour gap
        { id: '3', event_time: '2025-01-15T10:05:00Z', event_type: 'food', event_data: { description: 'Lunch' } },
        { id: '4', event_time: '2025-01-15T10:10:00Z', event_type: 'food', event_data: { description: 'Salad' } }
      ];

      const sessions = groupEventsIntoSessions(events, 30);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].items).toHaveLength(2);
      expect(sessions[1].items).toHaveLength(2);
    });

    it('should only include sessions with 2+ items', () => {
      const events = [
        { id: '1', event_time: '2025-01-15T08:00:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' } },
        // 2 hour gap - single item session should be excluded
        { id: '2', event_time: '2025-01-15T10:00:00Z', event_type: 'food', event_data: { description: 'Snack' } }
      ];

      const sessions = groupEventsIntoSessions(events, 30);

      // Both are single-item sessions, so both excluded
      expect(sessions).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      expect(groupEventsIntoSessions([], 30)).toEqual([]);
      expect(groupEventsIntoSessions(null, 30)).toEqual([]);
    });

    it('should handle edge case of exactly 30 minute gap', () => {
      const events = [
        { id: '1', event_time: '2025-01-15T08:00:00Z', event_type: 'supplement', event_data: { name: 'Item 1' } },
        { id: '2', event_time: '2025-01-15T08:30:00Z', event_type: 'supplement', event_data: { name: 'Item 2' } }
      ];

      const sessions = groupEventsIntoSessions(events, 30);

      // 30 minutes exactly should still be same session (<=)
      expect(sessions).toHaveLength(1);
      expect(sessions[0].items).toHaveLength(2);
    });
  });

  describe('detectMealPatterns', () => {
    it('should detect patterns with 2+ occurrences', async () => {
      // Mock events showing same items logged twice
      const mockEvents = [
        // Session 1: Morning supplements
        { id: '1', event_time: '2025-01-10T08:00:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' }, product_catalog_id: 'vit-d' },
        { id: '2', event_time: '2025-01-10T08:02:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' }, product_catalog_id: 'omega' },
        // Session 2: Same supplements, different day
        { id: '3', event_time: '2025-01-11T08:15:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' }, product_catalog_id: 'vit-d' },
        { id: '4', event_time: '2025-01-11T08:17:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' }, product_catalog_id: 'omega' }
      ];

      supabase.from = jest.fn((table) => {
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => ({
                  in: jest.fn(() => ({
                    order: jest.fn(() => Promise.resolve({ data: mockEvents, error: null }))
                  }))
                }))
              }))
            }))
          };
        }
        if (table === 'user_meal_templates') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          };
        }
        return {};
      });

      const patterns = await detectMealPatterns('user-123', { minOccurrences: 2 });

      expect(patterns).toHaveLength(1);
      expect(patterns[0].occurrences).toBe(2);
      expect(patterns[0].fingerprint).toBe('omega|vit-d');
    });

    it('should exclude patterns that already exist as templates', async () => {
      const mockEvents = [
        { id: '1', event_time: '2025-01-10T08:00:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' }, product_catalog_id: 'vit-d' },
        { id: '2', event_time: '2025-01-10T08:02:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' }, product_catalog_id: 'omega' },
        { id: '3', event_time: '2025-01-11T08:15:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' }, product_catalog_id: 'vit-d' },
        { id: '4', event_time: '2025-01-11T08:17:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' }, product_catalog_id: 'omega' }
      ];

      const existingTemplate = {
        id: 'template-123',
        fingerprint: 'omega|vit-d'
      };

      supabase.from = jest.fn((table) => {
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => ({
                  in: jest.fn(() => ({
                    order: jest.fn(() => Promise.resolve({ data: mockEvents, error: null }))
                  }))
                }))
              }))
            }))
          };
        }
        if (table === 'user_meal_templates') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [existingTemplate], error: null }))
            }))
          };
        }
        return {};
      });

      const patterns = await detectMealPatterns('user-123', { minOccurrences: 2 });

      // Pattern exists as template, so should be excluded
      expect(patterns).toHaveLength(0);
    });

    it('should return empty array for user with no events', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            gte: jest.fn(() => ({
              in: jest.fn(() => ({
                order: jest.fn(() => Promise.resolve({ data: [], error: null }))
              }))
            }))
          }))
        }))
      }));

      const patterns = await detectMealPatterns('user-123');

      expect(patterns).toEqual([]);
    });

    it('should return empty array for null userId', async () => {
      const patterns = await detectMealPatterns(null);
      expect(patterns).toEqual([]);
    });
  });

  describe('checkForPatternMatch', () => {
    it('should return template match when items match existing template', async () => {
      const mockTemplate = {
        id: 'template-123',
        template_name: 'Morning Supplements',
        fingerprint: 'omega|vit-d',
        items: [
          { product_id: 'vit-d', name: 'Vitamin D' },
          { product_id: 'omega', name: 'Omega-3' }
        ]
      };

      supabase.from = jest.fn((table) => {
        if (table === 'user_meal_templates') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [mockTemplate], error: null }))
            }))
          };
        }
        return {};
      });

      const currentItems = [
        { product_id: 'vit-d', name: 'Vitamin D' },
        { product_id: 'omega', name: 'Omega-3' }
      ];

      const result = await checkForPatternMatch('user-123', currentItems);

      expect(result.type).toBe('template');
      expect(result.similarity).toBe(1);
      expect(result.data.id).toBe('template-123');
    });

    it('should return pattern match when items match emerging pattern', async () => {
      // No existing templates
      supabase.from = jest.fn((table) => {
        if (table === 'user_meal_templates') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          };
        }
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => ({
                  in: jest.fn(() => ({
                    order: jest.fn(() => Promise.resolve({
                      data: [
                        { id: '1', event_time: '2025-01-10T08:00:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' }, product_catalog_id: 'vit-d' },
                        { id: '2', event_time: '2025-01-10T08:02:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' }, product_catalog_id: 'omega' },
                        { id: '3', event_time: '2025-01-11T08:15:00Z', event_type: 'supplement', event_data: { name: 'Vitamin D' }, product_catalog_id: 'vit-d' },
                        { id: '4', event_time: '2025-01-11T08:17:00Z', event_type: 'supplement', event_data: { name: 'Omega-3' }, product_catalog_id: 'omega' }
                      ],
                      error: null
                    }))
                  }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      const currentItems = [
        { product_id: 'vit-d', name: 'Vitamin D' },
        { product_id: 'omega', name: 'Omega-3' }
      ];

      const result = await checkForPatternMatch('user-123', currentItems);

      expect(result.type).toBe('pattern');
      expect(result.similarity).toBe(1);
    });

    it('should return null for no match', async () => {
      supabase.from = jest.fn((table) => {
        if (table === 'user_meal_templates') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          };
        }
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => ({
                  in: jest.fn(() => ({
                    order: jest.fn(() => Promise.resolve({ data: [], error: null }))
                  }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      const currentItems = [
        { product_id: 'new-product', name: 'New Supplement' }
      ];

      const result = await checkForPatternMatch('user-123', currentItems);

      expect(result.type).toBeNull();
      expect(result.similarity).toBe(0);
    });

    it('should return partial match with 70%+ similarity', async () => {
      const mockTemplate = {
        id: 'template-123',
        template_name: 'Morning Supplements',
        fingerprint: 'a|b|c|d',
        items: []
      };

      supabase.from = jest.fn((table) => {
        if (table === 'user_meal_templates') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [mockTemplate], error: null }))
            }))
          };
        }
        return {};
      });

      // 3 of 4 items = 75% match
      const currentItems = [
        { product_id: 'a', name: 'A' },
        { product_id: 'b', name: 'B' },
        { product_id: 'c', name: 'C' }
      ];

      const result = await checkForPatternMatch('user-123', currentItems);

      expect(result.type).toBe('template');
      expect(result.similarity).toBe(0.75);
    });

    it('should reject match with less than 70% similarity', async () => {
      const mockTemplate = {
        id: 'template-123',
        fingerprint: 'a|b|c|d|e',  // 5 items
        items: []
      };

      supabase.from = jest.fn((table) => {
        if (table === 'user_meal_templates') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [mockTemplate], error: null }))
            }))
          };
        }
        if (table === 'voice_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => ({
                  in: jest.fn(() => ({
                    order: jest.fn(() => Promise.resolve({ data: [], error: null }))
                  }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      // 2 of 5 items = 40% match (2 intersection, 5 union)
      const currentItems = [
        { product_id: 'a', name: 'A' },
        { product_id: 'b', name: 'B' }
      ];

      const result = await checkForPatternMatch('user-123', currentItems);

      // Below 70% threshold
      expect(result.type).toBeNull();
    });
  });

  describe('createTemplateFromPattern', () => {
    it('should create template with correct data', async () => {
      const mockInsertedTemplate = {
        id: 'new-template-uuid',
        user_id: 'user-123',
        template_name: 'Morning Supplements',
        template_key: 'morning supplements',
        fingerprint: 'omega|vit-d',
        times_logged: 0,
        auto_generated: true
      };

      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockInsertedTemplate, error: null }))
          }))
        }))
      }));

      const pattern = {
        fingerprint: 'omega|vit-d',
        items: [
          { product_id: 'vit-d', name: 'Vitamin D' },
          { product_id: 'omega', name: 'Omega-3' }
        ],
        typicalHour: 8
      };

      const result = await createTemplateFromPattern('user-123', pattern, 'Morning Supplements');

      expect(result.id).toBe('new-template-uuid');
      expect(result.auto_generated).toBe(true);
      expect(result.times_logged).toBe(0);
    });

    it('should generate correct time range from typicalHour', async () => {
      let insertPayload = null;

      supabase.from = jest.fn(() => ({
        insert: jest.fn((payload) => {
          insertPayload = payload;
          return {
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: { id: 'test' }, error: null }))
            }))
          };
        })
      }));

      const pattern = {
        fingerprint: 'test',
        items: [],
        typicalHour: 14  // 2 PM
      };

      await createTemplateFromPattern('user-123', pattern, 'Afternoon Snack');

      // Should be 13:00 - 15:59
      expect(insertPayload.typical_time_range).toBe('13:00-15:59');
    });

    it('should throw error for missing parameters', async () => {
      await expect(createTemplateFromPattern(null, {}, 'Name')).rejects.toThrow();
      await expect(createTemplateFromPattern('user', null, 'Name')).rejects.toThrow();
      await expect(createTemplateFromPattern('user', {}, null)).rejects.toThrow();
    });
  });

  describe('matchTemplateByVoice', () => {
    const { matchTemplateByVoice } = require('@/utils/mealPatterns');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return no match for empty transcription', async () => {
      const result = await matchTemplateByVoice('', 'user-123');
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should return no match for null userId', async () => {
      const result = await matchTemplateByVoice('my morning vitamins', null);
      expect(result.matched).toBe(false);
    });

    it('should return no match when user has no templates', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: [], error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('my morning vitamins', 'user-123');
      expect(result.matched).toBe(false);
    });

    it('should match exact template name', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Morning Stack',
          template_key: 'morning stack',
          items: [{ name: 'Vitamin D' }]
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('morning stack', 'user-123');
      expect(result.matched).toBe(true);
      expect(result.template.id).toBe('template-1');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should match with "my" prefix', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Morning Vitamins',
          template_key: 'morning vitamins',
          items: []
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('my morning vitamins', 'user-123');
      expect(result.matched).toBe(true);
      expect(result.template.template_name).toBe('Morning Vitamins');
    });

    it('should match with "log my" prefix', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Breakfast Stack',
          template_key: 'breakfast stack',
          items: []
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('log my breakfast stack', 'user-123');
      expect(result.matched).toBe(true);
    });

    it('should match with "took my" prefix', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Evening Supplements',
          template_key: 'evening supplements',
          items: []
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('took my evening supplements', 'user-123');
      expect(result.matched).toBe(true);
    });

    it('should match partial template name (word match)', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Morning Stack',
          template_key: 'morning stack',
          items: []
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('morning', 'user-123');
      expect(result.matched).toBe(true);
    });

    it('should not match unrelated transcription', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Morning Stack',
          template_key: 'morning stack',
          items: []
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('ate a chicken sandwich for lunch', 'user-123');
      expect(result.matched).toBe(false);
    });

    it('should select best match when multiple templates exist', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Morning Stack',
          template_key: 'morning stack',
          items: []
        },
        {
          id: 'template-2',
          template_name: 'Morning Vitamins',
          template_key: 'morning vitamins',
          items: []
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      // Should match "morning vitamins" exactly
      const result = await matchTemplateByVoice('my morning vitamins', 'user-123');
      expect(result.matched).toBe(true);
      expect(result.template.id).toBe('template-2');
    });

    it('should be case insensitive', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          template_name: 'Morning Stack',
          template_key: 'morning stack',
          items: []
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockTemplates, error: null }))
        }))
      }));

      const result = await matchTemplateByVoice('MORNING STACK', 'user-123');
      expect(result.matched).toBe(true);
    });
  });
});
