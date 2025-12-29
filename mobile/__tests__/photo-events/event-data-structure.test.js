/**
 * Event Data Structure Tests
 *
 * Tests for the new voice_events event_data structure that includes
 * product_catalog_id, calculated_nutrients, and is_manual_override.
 */

// Mock dependencies before imports
jest.mock('../../src/utils/supabaseClient', () => ({
  supabase: { from: jest.fn() }
}));

jest.mock('../../src/utils/photoAnalysis', () => ({
  analyzeSupplementPhoto: jest.fn(),
  uploadPhotoToSupabase: jest.fn(),
  generateFollowUpQuestion: jest.fn()
}));

jest.mock('../../src/utils/productCatalog', () => ({
  lookupByBarcode: jest.fn(),
  searchProductCatalog: jest.fn(),
  incrementProductUsage: jest.fn(),
  detectBarcode: jest.fn(),
  findCatalogMatch: jest.fn(),
  addProductToCatalog: jest.fn()
}));

jest.mock('../../src/utils/voiceEventParser', () => ({
  createAuditRecord: jest.fn(),
  updateAuditStatus: jest.fn(),
  createVoiceEvent: jest.fn()
}));

// Mock the nutrient calculation module
jest.mock('../../src/utils/nutrientCalculation', () => ({
  calculateConsumedNutrients: jest.fn()
}));

import { buildSupplementEventData } from '../../src/utils/photoEventParser';
import { calculateConsumedNutrients } from '../../src/utils/nutrientCalculation';

describe('Event Data Structure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildSupplementEventData', () => {
    const magteinCatalogEntry = {
      id: 'uuid-catalog-123',
      product_name: 'Magtein Magnesium L-Threonate',
      brand: 'NOW Foods',
      product_type: 'supplement',
      serving_quantity: 3,
      serving_unit: 'capsule',
      micros: {
        magnesium: { amount: 144, unit: 'mg' },
        magtein: { amount: 2000, unit: 'mg' }
      }
    };

    it('should include product_catalog_id when linked to catalog', () => {
      calculateConsumedNutrients.mockReturnValue({
        magnesium: { amount: 48, unit: 'mg' },
        magtein: { amount: 666.7, unit: 'mg' }
      });

      const eventData = buildSupplementEventData(
        magteinCatalogEntry,
        1, // amount consumed
        false // not manual override
      );

      expect(eventData.product_catalog_id).toBe('uuid-catalog-123');
      expect(eventData.name).toBe('Magtein Magnesium L-Threonate');
      expect(eventData.brand).toBe('NOW Foods');
    });

    it('should calculate nutrients based on amount consumed', () => {
      calculateConsumedNutrients.mockReturnValue({
        magnesium: { amount: 48, unit: 'mg' },
        magtein: { amount: 666.7, unit: 'mg' }
      });

      const eventData = buildSupplementEventData(
        magteinCatalogEntry,
        1, // 1 of 3 capsules
        false
      );

      expect(eventData.amount_consumed).toBe(1);
      expect(eventData.unit).toBe('capsule');
      expect(eventData.calculated_nutrients.magnesium.amount).toBe(48);
      expect(eventData.calculated_nutrients.magtein.amount).toBe(666.7);
    });

    it('should set is_manual_override to false for calculated values', () => {
      calculateConsumedNutrients.mockReturnValue({
        magnesium: { amount: 144, unit: 'mg' }
      });

      const eventData = buildSupplementEventData(
        magteinCatalogEntry,
        3,
        false
      );

      expect(eventData.is_manual_override).toBe(false);
    });

    it('should set is_manual_override to true when user edits values', () => {
      const userEditedNutrients = {
        magnesium: { amount: 150, unit: 'mg' } // User changed from 144
      };

      const eventData = buildSupplementEventData(
        magteinCatalogEntry,
        3,
        true, // manual override
        userEditedNutrients
      );

      expect(eventData.is_manual_override).toBe(true);
      expect(eventData.calculated_nutrients.magnesium.amount).toBe(150);
    });

    it('should handle full serving (3 capsules)', () => {
      calculateConsumedNutrients.mockReturnValue({
        magnesium: { amount: 144, unit: 'mg' },
        magtein: { amount: 2000, unit: 'mg' }
      });

      const eventData = buildSupplementEventData(
        magteinCatalogEntry,
        3,
        false
      );

      expect(eventData.amount_consumed).toBe(3);
      expect(eventData.calculated_nutrients.magnesium.amount).toBe(144);
      expect(eventData.calculated_nutrients.magtein.amount).toBe(2000);
    });

    it('should have correct structure matching spec', () => {
      calculateConsumedNutrients.mockReturnValue({
        magnesium: { amount: 48, unit: 'mg' },
        magtein: { amount: 666.7, unit: 'mg' }
      });

      const eventData = buildSupplementEventData(
        magteinCatalogEntry,
        1,
        false
      );

      // Verify exact structure from spec
      expect(eventData).toEqual({
        product_catalog_id: 'uuid-catalog-123',
        name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        amount_consumed: 1,
        unit: 'capsule',
        calculated_nutrients: {
          magnesium: { amount: 48, unit: 'mg' },
          magtein: { amount: 666.7, unit: 'mg' }
        },
        is_manual_override: false
      });
    });
  });

  describe('Legacy Format (No Catalog Match)', () => {
    it('should fall back to legacy format without catalog', () => {
      const eventData = buildSupplementEventData(
        null, // No catalog entry
        1,
        false,
        null,
        { name: 'Some Supplement', brand: 'Unknown' } // Detected info only
      );

      expect(eventData.product_catalog_id).toBeNull();
      expect(eventData.name).toBe('Some Supplement');
      expect(eventData.brand).toBe('Unknown');
      expect(eventData.dosage).toBe('1');
      expect(eventData.units).toBe('capsule');
      expect(eventData.calculated_nutrients).toBeUndefined();
    });
  });

  describe('Medication Event Data', () => {
    const ibuprofenCatalogEntry = {
      id: 'uuid-ibuprofen',
      product_name: 'Advil',
      brand: 'Pfizer',
      product_type: 'medication',
      serving_quantity: 1,
      serving_unit: 'tablet',
      active_ingredients: [
        { name: 'Ibuprofen', strength: '200mg', atc_code: 'M01AE01' }
      ],
      micros: {}
    };

    it('should handle medication with active ingredients', () => {
      calculateConsumedNutrients.mockReturnValue({});

      const eventData = buildSupplementEventData(
        ibuprofenCatalogEntry,
        2, // took 2 tablets
        false
      );

      expect(eventData.product_catalog_id).toBe('uuid-ibuprofen');
      expect(eventData.amount_consumed).toBe(2);
      expect(eventData.unit).toBe('tablet');
    });
  });

  describe('Food Event Data', () => {
    const granolaCatalogEntry = {
      id: 'uuid-granola',
      product_name: 'Oats & Honey Granola Bar',
      brand: 'Nature Valley',
      product_type: 'food',
      serving_quantity: 1,
      serving_unit: 'bar',
      serving_weight_grams: 42,
      micros: {
        calories: { amount: 190, unit: 'kcal' },
        protein: { amount: 4, unit: 'g' },
        carbs: { amount: 29, unit: 'g' },
        fat: { amount: 6, unit: 'g' }
      }
    };

    it('should calculate nutrients for food items', () => {
      calculateConsumedNutrients.mockReturnValue({
        calories: { amount: 380, unit: 'kcal' },
        protein: { amount: 8, unit: 'g' },
        carbs: { amount: 58, unit: 'g' },
        fat: { amount: 12, unit: 'g' }
      });

      const eventData = buildSupplementEventData(
        granolaCatalogEntry,
        2, // ate 2 bars
        false
      );

      expect(eventData.amount_consumed).toBe(2);
      expect(eventData.unit).toBe('bar');
      expect(eventData.calculated_nutrients.calories.amount).toBe(380);
    });
  });

  describe('Integration with handleFollowUpResponse', () => {
    // These tests verify the full flow from quantity input to event creation

    it('should create correct event_data when user enters quantity "1"', () => {
      calculateConsumedNutrients.mockReturnValue({
        magnesium: { amount: 48, unit: 'mg' },
        magtein: { amount: 666.7, unit: 'mg' }
      });

      const magteinCatalogEntry = {
        id: 'uuid-catalog-123',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        serving_quantity: 3,
        serving_unit: 'capsule',
        micros: {
          magnesium: { amount: 144, unit: 'mg' },
          magtein: { amount: 2000, unit: 'mg' }
        }
      };

      // Simulate what handleFollowUpResponse would do
      const quantity = 1;
      const eventData = buildSupplementEventData(
        magteinCatalogEntry,
        quantity,
        false
      );

      // Verify the exact structure expected in voice_events.event_data
      expect(eventData).toMatchObject({
        product_catalog_id: 'uuid-catalog-123',
        name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        amount_consumed: 1,
        unit: 'capsule',
        is_manual_override: false
      });

      expect(eventData.calculated_nutrients.magnesium.amount).toBe(48);
      expect(eventData.calculated_nutrients.magtein.amount).toBeCloseTo(666.7, 1);
    });
  });
});
