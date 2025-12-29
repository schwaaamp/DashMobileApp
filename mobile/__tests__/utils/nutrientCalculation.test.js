/**
 * Nutrient Calculation Tests
 *
 * Tests for calculating consumed nutrients based on
 * serving size and amount consumed.
 */

import { calculateConsumedNutrients } from '../../src/utils/nutrientCalculation';

describe('Nutrient Calculation', () => {
  describe('calculateConsumedNutrients', () => {
    const magteinProduct = {
      serving_quantity: 3,
      serving_unit: 'capsule',
      micros: {
        magnesium: { amount: 144, unit: 'mg' },
        magtein: { amount: 2000, unit: 'mg' }
      }
    };

    it('should calculate partial serving (1 of 3 capsules = 1/3 nutrients)', () => {
      const result = calculateConsumedNutrients(magteinProduct, 1);

      expect(result.magnesium.amount).toBeCloseTo(48, 1);
      expect(result.magnesium.unit).toBe('mg');
      expect(result.magtein.amount).toBeCloseTo(666.7, 1);
      expect(result.magtein.unit).toBe('mg');
    });

    it('should calculate full serving (3 of 3 capsules = full nutrients)', () => {
      const result = calculateConsumedNutrients(magteinProduct, 3);

      expect(result.magnesium.amount).toBe(144);
      expect(result.magnesium.unit).toBe('mg');
      expect(result.magtein.amount).toBe(2000);
      expect(result.magtein.unit).toBe('mg');
    });

    it('should calculate multiple servings (6 capsules = 2x nutrients)', () => {
      const result = calculateConsumedNutrients(magteinProduct, 6);

      expect(result.magnesium.amount).toBe(288);
      expect(result.magtein.amount).toBe(4000);
    });

    it('should handle decimal precision correctly', () => {
      const result = calculateConsumedNutrients(magteinProduct, 2);

      // 2/3 of 144 = 96
      expect(result.magnesium.amount).toBeCloseTo(96, 1);
      // 2/3 of 2000 = 1333.33...
      expect(result.magtein.amount).toBeCloseTo(1333.3, 1);
    });

    it('should handle products with many nutrients', () => {
      const multivitamin = {
        serving_quantity: 1,
        serving_unit: 'tablet',
        micros: {
          vitamin_a: { amount: 900, unit: 'mcg' },
          vitamin_c: { amount: 90, unit: 'mg' },
          vitamin_d: { amount: 20, unit: 'mcg' },
          vitamin_e: { amount: 15, unit: 'mg' },
          calcium: { amount: 200, unit: 'mg' },
          iron: { amount: 8, unit: 'mg' },
          zinc: { amount: 11, unit: 'mg' }
        }
      };

      const result = calculateConsumedNutrients(multivitamin, 1);

      expect(Object.keys(result)).toHaveLength(7);
      expect(result.vitamin_a.amount).toBe(900);
      expect(result.vitamin_c.amount).toBe(90);
    });

    it('should handle half tablet/capsule', () => {
      const result = calculateConsumedNutrients(magteinProduct, 1.5);

      // 1.5/3 = 0.5 of serving
      expect(result.magnesium.amount).toBeCloseTo(72, 1);
      expect(result.magtein.amount).toBeCloseTo(1000, 1);
    });

    it('should return empty object for product with no micros', () => {
      const emptyProduct = {
        serving_quantity: 1,
        serving_unit: 'capsule',
        micros: {}
      };

      const result = calculateConsumedNutrients(emptyProduct, 1);

      expect(result).toEqual({});
    });

    it('should handle null/undefined micros gracefully', () => {
      const noMicrosProduct = {
        serving_quantity: 1,
        serving_unit: 'capsule',
        micros: null
      };

      const result = calculateConsumedNutrients(noMicrosProduct, 1);

      expect(result).toEqual({});
    });

    it('should handle zero amount consumed', () => {
      const result = calculateConsumedNutrients(magteinProduct, 0);

      expect(result.magnesium.amount).toBe(0);
      expect(result.magtein.amount).toBe(0);
    });

    it('should handle serving_quantity of 1', () => {
      const singleServing = {
        serving_quantity: 1,
        serving_unit: 'scoop',
        micros: {
          protein: { amount: 25, unit: 'g' },
          creatine: { amount: 5, unit: 'g' }
        }
      };

      const result = calculateConsumedNutrients(singleServing, 2);

      expect(result.protein.amount).toBe(50);
      expect(result.creatine.amount).toBe(10);
    });
  });

  describe('Edge Cases', () => {
    it('should round to 1 decimal place', () => {
      const product = {
        serving_quantity: 7,
        serving_unit: 'tablet',
        micros: {
          vitamin_b12: { amount: 100, unit: 'mcg' }
        }
      };

      const result = calculateConsumedNutrients(product, 3);

      // 3/7 * 100 = 42.857...
      // Should round to 42.9
      expect(result.vitamin_b12.amount).toBeCloseTo(42.9, 1);
    });

    it('should preserve unit types (mg, mcg, g, IU)', () => {
      const product = {
        serving_quantity: 1,
        serving_unit: 'softgel',
        micros: {
          vitamin_d: { amount: 125, unit: 'mcg' },
          vitamin_e: { amount: 180, unit: 'IU' },
          omega_3: { amount: 1, unit: 'g' }
        }
      };

      const result = calculateConsumedNutrients(product, 2);

      expect(result.vitamin_d.unit).toBe('mcg');
      expect(result.vitamin_e.unit).toBe('IU');
      expect(result.omega_3.unit).toBe('g');
    });
  });
});
