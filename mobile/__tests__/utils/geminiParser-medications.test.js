/**
 * Tests for medication-specific parsing in geminiParser
 *
 * Tests active ingredient extraction for brand name medications
 */

import { parseTextWithGemini } from '../../src/utils/geminiParser';

// Mock fetch for Gemini API
global.fetch = jest.fn();

describe('geminiParser - Medication Active Ingredients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Single-ingredient brand name medications', () => {
    test('should extract active ingredient from Advil (Ibuprofen)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Advil',
          dosage: '200',
          units: 'mg',
          active_ingredients: [
            { name: 'Ibuprofen', strength: '200mg' }
          ]
        },
        confidence: 95
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('took 200mg Advil', 'test-api-key');

      expect(result.event_type).toBe('medication');
      expect(result.event_data.name).toBe('Advil');
      expect(result.event_data.active_ingredients).toHaveLength(1);
      expect(result.event_data.active_ingredients[0].name).toBe('Ibuprofen');
      expect(result.event_data.active_ingredients[0].strength).toBe('200mg');
    });

    test('should extract active ingredient from Tylenol (Paracetamol)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Tylenol',
          dosage: '500',
          units: 'mg',
          active_ingredients: [
            { name: 'Paracetamol', strength: '500mg' }
          ]
        },
        confidence: 95
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('500mg Tylenol', 'test-api-key');

      expect(result.event_type).toBe('medication');
      expect(result.event_data.active_ingredients).toHaveLength(1);
      expect(result.event_data.active_ingredients[0].name).toBe('Paracetamol');
    });

    test('should use INN (Paracetamol) instead of US name (Acetaminophen)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Tylenol',
          dosage: '650',
          units: 'mg',
          active_ingredients: [
            { name: 'Paracetamol', strength: '650mg' }
          ]
        },
        confidence: 95
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('took Tylenol 650mg', 'test-api-key');

      // Should use international name (Paracetamol), not US name (Acetaminophen)
      expect(result.event_data.active_ingredients[0].name).toBe('Paracetamol');
    });
  });

  describe('Multi-ingredient medications', () => {
    test('should extract all 3 active ingredients from NyQuil', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'NyQuil',
          dosage: '30',
          units: 'ml',
          active_ingredients: [
            { name: 'Paracetamol', strength: '650mg' },
            { name: 'Dextromethorphan', strength: '30mg' },
            { name: 'Doxylamine', strength: '12.5mg' }
          ]
        },
        confidence: 92
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('took 30ml NyQuil', 'test-api-key');

      expect(result.event_type).toBe('medication');
      expect(result.event_data.name).toBe('NyQuil');
      expect(result.event_data.active_ingredients).toHaveLength(3);

      // Verify all 3 ingredients
      const ingredientNames = result.event_data.active_ingredients.map(i => i.name);
      expect(ingredientNames).toContain('Paracetamol');
      expect(ingredientNames).toContain('Dextromethorphan');
      expect(ingredientNames).toContain('Doxylamine');
    });

    test('should extract both ingredients from Excedrin (Paracetamol + Aspirin + Caffeine)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Excedrin',
          dosage: '2',
          units: 'tablets',
          active_ingredients: [
            { name: 'Paracetamol', strength: '250mg' },
            { name: 'Aspirin', strength: '250mg' },
            { name: 'Caffeine', strength: '65mg' }
          ]
        },
        confidence: 93
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('2 Excedrin tablets', 'test-api-key');

      expect(result.event_data.active_ingredients).toHaveLength(3);
      expect(result.event_data.active_ingredients[0].name).toBe('Paracetamol');
      expect(result.event_data.active_ingredients[1].name).toBe('Aspirin');
      expect(result.event_data.active_ingredients[2].name).toBe('Caffeine');
    });
  });

  describe('Generic medication names', () => {
    test('should not extract active_ingredients for generic name (already active ingredient)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Ibuprofen',
          dosage: '400',
          units: 'mg'
          // No active_ingredients - generic name is already the ingredient
        },
        confidence: 98
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('400mg Ibuprofen', 'test-api-key');

      expect(result.event_type).toBe('medication');
      expect(result.event_data.name).toBe('Ibuprofen');
      // Generic names don't need active_ingredients array
      expect(result.event_data.active_ingredients).toBeUndefined();
    });

    test('should not extract active_ingredients for Metformin (generic)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Metformin',
          dosage: '500',
          units: 'mg'
        },
        confidence: 98
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('took 500mg Metformin', 'test-api-key');

      expect(result.event_data.name).toBe('Metformin');
      expect(result.event_data.active_ingredients).toBeUndefined();
    });
  });

  describe('International brand names', () => {
    test('should extract Paracetamol from UK brand "Panadol"', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Panadol',
          dosage: '500',
          units: 'mg',
          active_ingredients: [
            { name: 'Paracetamol', strength: '500mg' }
          ]
        },
        confidence: 95
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('500mg Panadol', 'test-api-key');

      expect(result.event_data.active_ingredients[0].name).toBe('Paracetamol');
    });

    test('should extract Ibuprofen from UK brand "Nurofen"', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Nurofen',
          dosage: '200',
          units: 'mg',
          active_ingredients: [
            { name: 'Ibuprofen', strength: '200mg' }
          ]
        },
        confidence: 95
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('took 200mg Nurofen', 'test-api-key');

      expect(result.event_data.active_ingredients[0].name).toBe('Ibuprofen');
    });
  });

  describe('Edge cases', () => {
    test('should handle medications with unknown brand names (no active_ingredients)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'UnknownBrandXYZ',
          dosage: '100',
          units: 'mg'
          // No active_ingredients - brand not recognized
        },
        confidence: 60
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('took UnknownBrandXYZ 100mg', 'test-api-key');

      expect(result.event_data.name).toBe('UnknownBrandXYZ');
      expect(result.event_data.active_ingredients).toBeUndefined();
      expect(result.confidence).toBeLessThan(70); // Lower confidence
    });

    test('should validate event is complete without active_ingredients for generic names', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Lisinopril',
          dosage: '10',
          units: 'mg'
        },
        confidence: 98
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('10mg Lisinopril', 'test-api-key');

      // Medication schema requires: name, dosage
      // active_ingredients is OPTIONAL
      expect(result.complete).toBe(true);
      expect(result.event_data.name).toBe('Lisinopril');
      expect(result.event_data.dosage).toBe('10');
    });
  });

  describe('Strength formatting', () => {
    test('should format strength with units (mg, ml, etc)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Advil',
          dosage: '400',
          units: 'mg',
          active_ingredients: [
            { name: 'Ibuprofen', strength: '400mg' }
          ]
        },
        confidence: 95
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockResponse) }]
            }
          }]
        })
      });

      const result = await parseTextWithGemini('took 400mg Advil', 'test-api-key');

      expect(result.event_data.active_ingredients[0].strength).toBe('400mg');
      // Strength includes units in string format
      expect(result.event_data.active_ingredients[0].strength).toMatch(/\d+mg/);
    });
  });
});
