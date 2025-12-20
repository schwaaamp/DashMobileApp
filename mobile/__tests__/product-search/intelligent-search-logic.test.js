/**
 * Test Suite for Phase 1: Intelligent Product Search Logic
 *
 * Tests the new conditional search strategy with 83% confidence threshold,
 * brand detection, and phonetic transformation detection.
 */

import { shouldSearchProducts } from '@/utils/productSearch';

describe('Intelligent Product Search Logic', () => {

  describe('High Confidence + Known Brand = SKIP', () => {

    it('should SKIP search for high confidence (90%) supplement with known brand (LMNT)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'LMNT Lemonade' },
        90,
        'LMNT Lemonade',
        'LMNT Lemonade'
      );

      expect(result).toBe(false);
    });

    it('should SKIP search for high confidence (85%) supplement with known brand (NOW)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'NOW Magtein Magnesium L-Threonate' },
        85,
        'NOW Magtein',
        'NOW Magtein Magnesium L-Threonate'
      );

      expect(result).toBe(false);
    });

    it('should SKIP search for high confidence (84%) medication with known brand', () => {
      const result = shouldSearchProducts(
        'medication',
        { name: 'Jarrow B-Complex' },
        84,
        'Jarrow B-Complex',
        'Jarrow B-Complex'
      );

      expect(result).toBe(false);
    });

  });

  describe('Threshold Edge Cases (83%)', () => {

    it('should SKIP search at 84% confidence with brand', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'Thorne Vitamin D' },
        84,
        'Thorne Vitamin D',
        'Thorne Vitamin D'
      );

      expect(result).toBe(false);
    });

    it('should SEARCH at 83% confidence (at threshold)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'Thorne Vitamin D' },
        83,
        'Thorne Vitamin D',
        'Thorne Vitamin D'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH at 82% confidence (below threshold)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'Thorne Vitamin D' },
        82,
        'Thorne Vitamin D',
        'Thorne Vitamin D'
      );

      expect(result).toBe(true);
    });

  });

  describe('High Confidence WITHOUT Brand = SEARCH', () => {

    it('should SEARCH for high confidence (90%) supplement without known brand', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'Magnesium L-Threonate' },
        90,
        'Magnesium L-Threonate',
        'Magnesium L-Threonate'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for high confidence (95%) with unknown brand name', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'XYZ Brand Vitamin D' },
        95,
        'XYZ Brand Vitamin D',
        'XYZ Brand Vitamin D'
      );

      expect(result).toBe(true);
    });

  });

  describe('Phonetic Transformation Detection = SEARCH', () => {

    it('should SEARCH when "element" transformed to "lmnt" (even at 85% confidence)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'LMNT Lemonade' },
        85,
        'lemonade element pack',  // user input
        'LMNT Lemonade'  // Claude output
      );

      // Should search because phonetic transformation detected
      expect(result).toBe(true);
    });

    it('should SEARCH when "citrus element" transformed to "citrus lmnt"', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'LMNT Citrus Salt' },
        90,
        'citrus element',  // user input
        'LMNT Citrus Salt'  // Claude output
      );

      expect(result).toBe(true);
    });

    it('should SKIP when no phonetic transformation occurred', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'NOW Vitamin D' },
        90,
        'NOW Vitamin D',  // user input
        'NOW Vitamin D'  // Claude output - same
      );

      expect(result).toBe(false);
    });

  });

  describe('Food = ALWAYS SEARCH', () => {

    it('should SEARCH for high confidence (95%) food', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'chicken breast' },
        95,
        'chicken breast',
        'chicken breast'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for low confidence (60%) food', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'some meat' },
        60,
        'some meat',
        'some meat'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for food even with known brand', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'Orgain Protein Shake' },
        95,
        'Orgain Protein Shake',
        'Orgain Protein Shake'
      );

      expect(result).toBe(true);
    });

  });

  describe('Low/Medium Confidence = SEARCH', () => {

    it('should SEARCH for 50% confidence supplement', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'some vitamin' },
        50,
        'some vitamin',
        'some vitamin'
      );

      expect(result).toBe(true);
    });

    it('should SEARCH for 75% confidence supplement', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'vitamin d supplement' },
        75,
        'vitamin d',
        'vitamin d supplement'
      );

      expect(result).toBe(true);
    });

  });

  describe('Non-searchable Event Types', () => {

    it('should NOT search for insulin (not food/supplement/medication)', () => {
      const result = shouldSearchProducts(
        'insulin',
        { value: 6, units: 'units' },
        90,
        '6 units insulin',
        '6 units insulin'
      );

      expect(result).toBe(false);
    });

    it('should NOT search for sauna', () => {
      const result = shouldSearchProducts(
        'sauna',
        { duration: '25' },
        95,
        'sauna 25 minutes',
        'sauna 25 minutes'
      );

      expect(result).toBe(false);
    });

    it('should NOT search for exercise', () => {
      const result = shouldSearchProducts(
        'exercise',
        { activity: 'running' },
        90,
        'went for a run',
        'running'
      );

      expect(result).toBe(false);
    });

  });

  describe('Brand Name Detection', () => {

    it('should detect "lmnt" in various cases', () => {
      expect(shouldSearchProducts('supplement', { description: 'LMNT Lemonade' }, 90)).toBe(false);
      expect(shouldSearchProducts('supplement', { description: 'lmnt citrus' }, 85)).toBe(false);
      expect(shouldSearchProducts('supplement', { description: 'LMNT ELEMENT PACK' }, 90)).toBe(false);
    });

    it('should detect "now" brand', () => {
      expect(shouldSearchProducts('supplement', { description: 'NOW Foods Vitamin D' }, 90)).toBe(false);
      expect(shouldSearchProducts('supplement', { description: 'now magtein' }, 85)).toBe(false);
    });

    it('should detect "thorne" brand', () => {
      expect(shouldSearchProducts('supplement', { description: 'Thorne B-Complex' }, 90)).toBe(false);
    });

    it('should detect "jarrow" brand', () => {
      expect(shouldSearchProducts('supplement', { description: 'Jarrow Formulas CoQ10' }, 88)).toBe(false);
    });

  });

  describe('Real World Scenarios', () => {

    it('Scenario: User says "LMNT Lemonade" clearly -> Claude confident with brand -> SKIP', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'LMNT Lemonade' },
        95,
        'LMNT Lemonade',
        'LMNT Lemonade'
      );

      expect(result).toBe(false);
    });

    it('Scenario: User says "lemonade element pack" -> Claude interprets as "LMNT Lemonade" -> SEARCH (transformation)', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'LMNT Lemonade' },
        85,
        'lemonade element pack',
        'LMNT Lemonade'
      );

      expect(result).toBe(true);
    });

    it('Scenario: User says "chicken breast" -> High confidence food -> SEARCH (always search food)', () => {
      const result = shouldSearchProducts(
        'food',
        { description: 'chicken breast' },
        90,
        'chicken breast',
        'chicken breast'
      );

      expect(result).toBe(true);
    });

    it('Scenario: User says "some protein thing" -> Low confidence -> SEARCH', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'protein shake' },
        60,
        'some protein thing',
        'protein shake'
      );

      expect(result).toBe(true);
    });

    it('Scenario: User says "NOW Magtein" -> High confidence with brand -> SKIP', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'NOW Magtein Magnesium L-Threonate' },
        92,
        'NOW Magtein',
        'NOW Magtein Magnesium L-Threonate'
      );

      expect(result).toBe(false);
    });

    it('Scenario: User logs generic "magnesium" -> No brand, high confidence -> SEARCH', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: 'Magnesium' },
        88,
        'magnesium',
        'Magnesium'
      );

      expect(result).toBe(true);
    });

  });

  describe('Edge Cases', () => {

    it('should handle missing eventData gracefully', () => {
      const result = shouldSearchProducts(
        'supplement',
        null,
        90,
        'test',
        'test'
      );

      // Should search because no description to detect brand
      expect(result).toBe(true);
    });

    it('should handle missing description gracefully', () => {
      const result = shouldSearchProducts(
        'supplement',
        {},
        90,
        'test',
        'test'
      );

      expect(result).toBe(true);
    });

    it('should handle empty strings', () => {
      const result = shouldSearchProducts(
        'supplement',
        { description: '' },
        90,
        '',
        ''
      );

      expect(result).toBe(true);
    });

  });

});
