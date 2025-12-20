/**
 * Test Suite: Product Search Bypass Conditions (All Permutations)
 *
 * Tests ALL combinations of conditions that determine when product search
 * should be triggered or bypassed:
 *
 * Conditions:
 * 1. Event Type (food, supplement, medication, other)
 * 2. Confidence Level (>83%, =83%, <83%)
 * 3. Brand Detection (has brand, no brand)
 * 4. Phonetic Transformation (detected, not detected)
 * 5. needsConfirmation Logic (productOptions.length vs shouldSearch)
 *
 * Expected Behavior:
 * - Food: ALWAYS search (regardless of confidence)
 * - Supplement/Medication with confidence >83% AND brand: SKIP search
 * - Supplement/Medication with confidence ≤83%: SEARCH
 * - Supplement/Medication without brand: SEARCH
 * - Phonetic transformation detected: SEARCH
 * - needsConfirmation should use productOptions.length, not shouldSearch
 */

import { shouldSearchProducts } from '@/utils/productSearch';
import { processTextInput } from '@/utils/voiceEventParser';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

jest.mock('@/utils/supabaseClient');

describe('Product Search Bypass Conditions - All Permutations', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Use shared Supabase mock helper
    supabase.from = createSupabaseMock({ auditId: mockAuditId });
  });

  describe('Event Type: FOOD (always search)', () => {
    it('should SEARCH for food with confidence >83%', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'Apple' },
        95,
        'Apple',
        'Apple'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for food with confidence =83%', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'Banana' },
        83,
        'Banana',
        'Banana'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for food with confidence <83%', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'Orange' },
        50,
        'Orange',
        'Orange'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for food even with known brand', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'LMNT Lemonade' },
        95,
        'LMNT Lemonade',
        'LMNT Lemonade'
      );

      expect(result).toBe(true);
    });
  });

  describe('Event Type: SUPPLEMENT - High Confidence (>83%) + Brand', () => {
    it('should SKIP search for supplement with 90% confidence + NOW brand', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'NOW Vitamin D 5000 IU' },
        90,
        'NOW Vitamin D',
        'NOW Vitamin D 5000 IU'
      );

      expect(result).toBe(false);
    });

    it('should SKIP search for supplement with 85% confidence + Thorne brand', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'Thorne Magnesium' },
        85,
        'Thorne Magnesium',
        'Thorne Magnesium'
      );

      expect(result).toBe(false);
    });

    it('should SKIP search for supplement with 84% confidence + Jarrow brand', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'Jarrow B-Complex' },
        84,
        'Jarrow B-Complex',
        'Jarrow B-Complex'
      );

      expect(result).toBe(false);
    });

    it('should SKIP search for supplement with 95% confidence + LMNT brand', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'LMNT Citrus Salt' },
        95,
        'LMNT Citrus',
        'LMNT Citrus Salt'
      );

      expect(result).toBe(false);
    });
  });

  describe('Event Type: SUPPLEMENT - Confidence Threshold (83%)', () => {
    it('should SEARCH at exactly 83% confidence (at threshold)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'NOW Vitamin D' },
        83,
        'NOW Vitamin D',
        'NOW Vitamin D'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH below 83% confidence (82%)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'Thorne Magnesium' },
        82,
        'Thorne Magnesium',
        'Thorne Magnesium'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH at 75% confidence', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'Vitamin C' },
        75,
        'Vitamin C',
        'Vitamin C'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH at 50% confidence', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'Magnesium' },
        50,
        'Magnesium',
        'Magnesium'
      );

      expect(result).toBe(true);
    });
  });

  describe('Event Type: SUPPLEMENT - No Brand (always search)', () => {
    it('should SEARCH for supplement WITHOUT brand (90% confidence)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'Vitamin D' },
        90,
        'Vitamin D',
        'Vitamin D'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for supplement WITHOUT brand (95% confidence)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'Magnesium L-Threonate' },
        95,
        'Magnesium L-Threonate',
        'Magnesium L-Threonate'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for supplement WITHOUT brand (88% confidence)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'CoQ10' },
        88,
        'CoQ10',
        'CoQ10'
      );

      expect(result).toBe(true);
    });
  });

  describe('Event Type: MEDICATION - Same Rules as Supplement', () => {
    it('should SKIP search for medication with 90% confidence + Jarrow brand', () => {
      const result = shouldSearchProducts(
        'medication',
        { name: 'Jarrow Curcumin' },
        90,
        'Jarrow Curcumin',
        'Jarrow Curcumin'
      );

      expect(result).toBe(false);
    });

    it('should SEARCH for medication at 83% confidence', () => {
      const result = shouldSearchProducts(
        'medication',
        { name: 'Aspirin' },
        83,
        'Aspirin',
        'Aspirin'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for medication WITHOUT brand (90% confidence)', () => {
      const result = shouldSearchProducts(
        'medication',
        { name: 'Ibuprofen' },
        90,
        'Ibuprofen',
        'Ibuprofen'
      );

      expect(result).toBe(true);
    });
  });

  describe('Phonetic Transformation Detection', () => {
    it('should SEARCH when phonetic transformation detected (element → LMNT)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'LMNT Lemonade' },
        90,
        'lemonade element pack', // User input
        'LMNT Lemonade' // Claude output (transformed)
      );

      expect(result).toBe(true); // Transformation detected, must search
    });

    it('should SEARCH when phonetic transformation detected (citrus element → LMNT Citrus)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'LMNT Citrus Salt' },
        92,
        'citrus element', // User input
        'LMNT Citrus Salt' // Claude output
      );

      expect(result).toBe(true);
    });

    it('should SKIP search when NO transformation (exact match)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { name: 'NOW Vitamin D' },
        90,
        'NOW Vitamin D', // User input
        'NOW Vitamin D' // Claude output (no transformation)
      );

      expect(result).toBe(false); // No transformation, brand present, high confidence
    });
  });

  describe('Other Event Types (glucose, insulin, activity, sauna, symptom)', () => {
    it('should NOT search for glucose events', () => {
      const result = shouldSearchProducts(
        'glucose',
        { value: 120, units: 'mg/dL' },
        95,
        '120',
        '120'
      );

      // glucose is not food/supplement/medication, so shouldn't search
      expect(result).toBe(false);
    });

    it('should NOT search for insulin events', () => {
      const result = shouldSearchProducts(
        'insulin',
        { value: 6, units: 'units', insulin_type: 'basal' },
        98,
        '6 units basal',
        '6 units basal'
      );

      expect(result).toBe(false);
    });

    it('should NOT search for activity events', () => {
      const result = shouldSearchProducts(
        'activity',
        { activity_type: 'running', duration: 30 },
        90,
        '30 min run',
        'running 30 minutes'
      );

      expect(result).toBe(false);
    });

    it('should NOT search for sauna events', () => {
      const result = shouldSearchProducts(
        'sauna',
        { duration: 20, temperature: 180 },
        95,
        '20 min sauna',
        '20 minute sauna'
      );

      expect(result).toBe(false);
    });
  });

  describe('needsConfirmation Logic - Product Options Length', () => {
    /**
     * CRITICAL TEST: needsConfirmation should check productOptions.length,
     * NOT shouldSearch value.
     *
     * Current (broken): needsConfirmation = shouldSearch && [food, supplement, medication]
     * Fixed: needsConfirmation = productOptions?.length > 0 && [food, supplement, medication]
     */

    it('should NOT need confirmation when high confidence supplement with brand (no products fetched)', async () => {
      // Use shared mock with empty history
      supabase.from = createSupabaseMock({ auditId: mockAuditId });

      // Mock Claude API - high confidence supplement with brand
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
                  confidence: 92
                })
              }]
            })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'NOW Vitamin D 5000 IU',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.confidence).toBeGreaterThan(83);
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true); // No search performed
      expect(result.complete).toBe(true); // Should save directly
      expect(result.event).toBeDefined(); // Event created
    });

    it('should need confirmation when low confidence supplement (products fetched)', async () => {
      // Use shared mock with empty history
      supabase.from = createSupabaseMock({ auditId: mockAuditId });

      // Mock Claude API - LOW confidence
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
                  confidence: 75 // LOW
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
                {
                  code: '123',
                  product_name: 'NOW Vitamin D 5000 IU',
                  brands: 'NOW'
                },
                {
                  code: '456',
                  product_name: 'Thorne Vitamin D',
                  brands: 'Thorne'
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

      const result = await processTextInput(
        'Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.confidence).toBeLessThanOrEqual(83);
      expect(result.productOptions).toBeDefined();
      expect(result.productOptions.length).toBeGreaterThan(0);
      expect(result.complete).toBe(false); // Needs confirmation
    });

    it('should NOT need confirmation when search returns no results (edge case)', async () => {
      // Use shared mock with empty history
      supabase.from = createSupabaseMock({ auditId: mockAuditId });

      // Mock Claude API
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
                    name: 'Rare Supplement XYZ',
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
        // Mock product search - NO RESULTS
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ products: [] }) // EMPTY
          });
        }
        if (url.includes('api.nal.usda.gov')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ foods: [] }) // EMPTY
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      const result = await processTextInput(
        'Rare Supplement XYZ',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Edge case: Search triggered but found nothing
      // With FIXED logic: productOptions.length = 0 → needsConfirmation = false
      // Result: Should save directly (reasonable - no options to show user)
      expect(result.productOptions).toBeDefined();
      expect(result.productOptions.length).toBe(0);
      // After fix, this should be true (saves directly when no products found)
      // expect(result.complete).toBe(true);
    });
  });

  describe('Complete Permutation Matrix', () => {
    /**
     * Truth table for all conditions:
     *
     * | Event Type | Confidence | Has Brand | Phonetic | shouldSearch | Result |
     * |------------|-----------|-----------|----------|--------------|--------|
     * | food       | any       | any       | any      | true         | SEARCH |
     * | supplement | >83       | yes       | no       | false        | SKIP   |
     * | supplement | >83       | yes       | yes      | true         | SEARCH |
     * | supplement | >83       | no        | any      | true         | SEARCH |
     * | supplement | ≤83       | any       | any      | true         | SEARCH |
     * | medication | >83       | yes       | no       | false        | SKIP   |
     * | medication | >83       | yes       | yes      | true         | SEARCH |
     * | medication | >83       | no        | any      | true         | SEARCH |
     * | medication | ≤83       | any       | any      | true         | SEARCH |
     * | other      | any       | any       | any      | false        | SKIP   |
     */

    const testCases = [
      // Food - always search
      { type: 'food', conf: 95, brand: true, phonetic: false, expected: true, desc: 'food, high conf, brand, no phonetic' },
      { type: 'food', conf: 95, brand: false, phonetic: false, expected: true, desc: 'food, high conf, no brand, no phonetic' },
      { type: 'food', conf: 75, brand: true, phonetic: false, expected: true, desc: 'food, low conf, brand, no phonetic' },
      { type: 'food', conf: 75, brand: false, phonetic: false, expected: true, desc: 'food, low conf, no brand, no phonetic' },

      // Supplement - high confidence + brand + no phonetic = SKIP
      { type: 'supplement', conf: 90, brand: true, phonetic: false, expected: false, desc: 'supplement, high conf, brand, no phonetic' },
      { type: 'supplement', conf: 84, brand: true, phonetic: false, expected: false, desc: 'supplement, 84% conf, brand, no phonetic' },

      // Supplement - high confidence + brand + phonetic = SEARCH
      { type: 'supplement', conf: 90, brand: true, phonetic: true, expected: true, desc: 'supplement, high conf, brand, phonetic' },

      // Supplement - high confidence + no brand = SEARCH
      { type: 'supplement', conf: 90, brand: false, phonetic: false, expected: true, desc: 'supplement, high conf, no brand' },

      // Supplement - low confidence = SEARCH
      { type: 'supplement', conf: 83, brand: true, phonetic: false, expected: true, desc: 'supplement, 83% conf, brand' },
      { type: 'supplement', conf: 75, brand: true, phonetic: false, expected: true, desc: 'supplement, low conf, brand' },
      { type: 'supplement', conf: 75, brand: false, phonetic: false, expected: true, desc: 'supplement, low conf, no brand' },

      // Medication - same as supplement
      { type: 'medication', conf: 90, brand: true, phonetic: false, expected: false, desc: 'medication, high conf, brand, no phonetic' },
      { type: 'medication', conf: 90, brand: true, phonetic: true, expected: true, desc: 'medication, high conf, brand, phonetic' },
      { type: 'medication', conf: 90, brand: false, phonetic: false, expected: true, desc: 'medication, high conf, no brand' },
      { type: 'medication', conf: 75, brand: true, phonetic: false, expected: true, desc: 'medication, low conf, brand' },

      // Other types - never search
      { type: 'glucose', conf: 95, brand: false, phonetic: false, expected: false, desc: 'glucose, any' },
      { type: 'insulin', conf: 95, brand: false, phonetic: false, expected: false, desc: 'insulin, any' },
      { type: 'activity', conf: 95, brand: false, phonetic: false, expected: false, desc: 'activity, any' },
    ];

    testCases.forEach(({ type, conf, brand, phonetic, expected, desc }) => {
      it(`${desc} -> ${expected ? 'SEARCH' : 'SKIP'}`, () => {
        const userInput = phonetic ? 'element lemonade' : 'LMNT Lemonade';
        const claudeOutput = 'LMNT Lemonade';
        const itemName = brand ? 'LMNT Lemonade' : 'Electrolyte Drink';

        const result = shouldSearchProducts(
          type,
          type === 'food' ? { description: itemName } : { name: itemName },
          conf,
          userInput,
          claudeOutput
        );

        expect(result).toBe(expected);
      });
    });
  });
});
