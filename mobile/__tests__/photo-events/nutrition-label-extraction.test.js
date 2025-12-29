/**
 * Nutrition Label Extraction Tests
 *
 * Tests for extracting data from supplement/food nutrition labels
 * using Gemini Vision API.
 */

// Mock expo-file-system/legacy
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' }
}));

// Mock fetch for Gemini API calls
global.fetch = jest.fn();

import * as FileSystem from 'expo-file-system/legacy';
import { extractNutritionLabel } from '../../src/utils/nutritionLabelExtractor';

describe('Nutrition Label Extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FileSystem.readAsStringAsync.mockResolvedValue('base64encodedimage');
  });

  describe('extractNutritionLabel', () => {
    it('should extract supplement facts from Magtein label', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_quantity: 3,
                serving_unit: 'capsule',
                serving_weight_grams: null,
                micros: {
                  magnesium: { amount: 144, unit: 'mg' },
                  magtein: { amount: 2000, unit: 'mg' }
                },
                active_ingredients: [
                  { name: 'Magnesium L-Threonate', atc_code: 'A12CC' }
                ],
                barcode: null,
                barcode_confidence: 0
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///photo.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.data.serving_quantity).toBe(3);
      expect(result.data.serving_unit).toBe('capsule');
      expect(result.data.micros.magnesium.amount).toBe(144);
      expect(result.data.micros.magtein.amount).toBe(2000);
      expect(result.data.active_ingredients).toHaveLength(1);
    });

    it('should extract food nutrition facts', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_quantity: 1,
                serving_unit: 'bar',
                serving_weight_grams: 42,
                micros: {
                  calories: { amount: 190, unit: 'kcal' },
                  protein: { amount: 4, unit: 'g' },
                  carbs: { amount: 29, unit: 'g' },
                  fat: { amount: 6, unit: 'g' },
                  fiber: { amount: 2, unit: 'g' },
                  sugar: { amount: 11, unit: 'g' }
                },
                active_ingredients: [],
                barcode: '016000439801',
                barcode_confidence: 95
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///granola-bar.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.data.serving_weight_grams).toBe(42);
      expect(result.data.micros.calories.amount).toBe(190);
      expect(result.data.barcode).toBe('016000439801');
    });

    it('should include barcode only when confidence > 80', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_quantity: 2,
                serving_unit: 'tablet',
                serving_weight_grams: null,
                micros: {
                  vitamin_d: { amount: 50, unit: 'mcg' }
                },
                active_ingredients: [],
                barcode: '123456789012',
                barcode_confidence: 85
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///vitamin-d.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.data.barcode).toBe('123456789012');
    });

    it('should exclude barcode when confidence < 80', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_quantity: 2,
                serving_unit: 'tablet',
                serving_weight_grams: null,
                micros: {
                  vitamin_d: { amount: 50, unit: 'mcg' }
                },
                active_ingredients: [],
                barcode: '123456789012',
                barcode_confidence: 60
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///blurry-label.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.data.barcode).toBeNull();
    });

    it('should handle medication label format', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_quantity: 1,
                serving_unit: 'tablet',
                serving_weight_grams: null,
                micros: {},
                active_ingredients: [
                  { name: 'Ibuprofen', atc_code: 'M01AE01', strength: '200mg' },
                  { name: 'Pseudoephedrine', atc_code: 'R01BA02', strength: '30mg' }
                ],
                barcode: null,
                barcode_confidence: 0
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///advil-cold.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.data.active_ingredients).toHaveLength(2);
      expect(result.data.active_ingredients[0].name).toBe('Ibuprofen');
      expect(result.data.active_ingredients[0].atc_code).toBe('M01AE01');
    });

    it('should return error when label is unreadable', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                error: 'Unable to read nutrition label',
                readable: false
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///blurry.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.needsRetake).toBe(true);
      expect(result.error).toContain('Unable to read');
    });

    it('should handle Gemini API error', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      const result = await extractNutritionLabel(
        'file:///photo.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('API error');
    });

    it('should handle malformed JSON response', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: 'This is not valid JSON'
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///photo.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('parse');
    });
  });

  describe('Validation', () => {
    it('should require serving_quantity', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_unit: 'capsule',
                micros: { magnesium: { amount: 100, unit: 'mg' } }
                // Missing serving_quantity
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///photo.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('serving_quantity');
    });

    it('should require serving_unit', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_quantity: 1,
                // Missing serving_unit
                micros: { magnesium: { amount: 100, unit: 'mg' } }
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///photo.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('serving_unit');
    });

    it('should require at least one nutrient or active ingredient', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                serving_quantity: 1,
                serving_unit: 'capsule',
                micros: {},
                active_ingredients: []
              })
            }]
          }
        }]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse)
      });

      const result = await extractNutritionLabel(
        'file:///photo.jpg',
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('nutrient');
    });
  });
});
