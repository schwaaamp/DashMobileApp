/**
 * Tests for event type classification (Phase 3)
 *
 * Tests food/supplement/medication classification edge cases
 * Ensures all other event types (sauna, glucose, etc.) remain functional
 */

import { parseTextWithGemini } from '../../src/utils/geminiParser';

// Mock fetch for Gemini API
global.fetch = jest.fn();

describe('Event Type Classification - Phase 3', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Food classification (whole foods, meals)', () => {
    test('should classify "apple" as food', async () => {
      const mockResponse = {
        event_type: 'food',
        event_data: {
          description: 'Apple',
          calories: 95
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

      const result = await parseTextWithGemini('ate an apple', 'test-api-key');

      expect(result.event_type).toBe('food');
      expect(result.event_data.description).toBe('Apple');
    });

    test('should classify "chicken breast" as food', async () => {
      const mockResponse = {
        event_type: 'food',
        event_data: {
          description: 'Chicken breast',
          calories: 165,
          protein: 31
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

      const result = await parseTextWithGemini('ate chicken breast', 'test-api-key');

      expect(result.event_type).toBe('food');
    });

    test('should classify "pizza" as food', async () => {
      const mockResponse = {
        event_type: 'food',
        event_data: {
          description: 'Pizza',
          calories: 285
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

      const result = await parseTextWithGemini('had 2 slices of pizza', 'test-api-key');

      expect(result.event_type).toBe('food');
    });
  });

  describe('Supplement classification (vitamins, protein, electrolytes)', () => {
    test('should classify "protein powder" as supplement (not food)', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'Protein powder',
          dosage: '1 scoop'
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

      const result = await parseTextWithGemini('had protein powder', 'test-api-key');

      expect(result.event_type).toBe('supplement');
      expect(result.event_data.name).toBe('Protein powder');
    });

    test('should classify "Vitamin D" as supplement (not medication)', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'Vitamin D',
          dosage: '2000',
          units: 'IU'
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

      const result = await parseTextWithGemini('took 2000 IU Vitamin D', 'test-api-key');

      expect(result.event_type).toBe('supplement');
    });

    test('should classify "fish oil" as supplement (not medication)', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'Fish oil',
          dosage: '1',
          units: 'softgel'
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

      const result = await parseTextWithGemini('took fish oil', 'test-api-key');

      expect(result.event_type).toBe('supplement');
    });

    test('should classify "creatine" as supplement', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'Creatine',
          dosage: '5',
          units: 'g'
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

      const result = await parseTextWithGemini('took 5g creatine', 'test-api-key');

      expect(result.event_type).toBe('supplement');
    });

    test('should classify "LMNT" as supplement', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'LMNT Citrus',
          dosage: '1',
          units: 'pack'
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

      const result = await parseTextWithGemini('had LMNT citrus', 'test-api-key');

      expect(result.event_type).toBe('supplement');
    });

    test('should classify "collagen powder" as supplement', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'Collagen powder',
          dosage: '1 scoop'
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

      const result = await parseTextWithGemini('had collagen powder', 'test-api-key');

      expect(result.event_type).toBe('supplement');
    });

    test('should classify "probiotic" as supplement', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'Probiotic',
          dosage: '1',
          units: 'capsule'
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

      const result = await parseTextWithGemini('took probiotic', 'test-api-key');

      expect(result.event_type).toBe('supplement');
    });
  });

  describe('Medication classification (pharmaceuticals)', () => {
    test('should classify "Advil" as medication (not supplement)', async () => {
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
    });

    test('should classify "Ibuprofen" as medication (generic name)', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Ibuprofen',
          dosage: '400',
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

      const result = await parseTextWithGemini('took 400mg Ibuprofen', 'test-api-key');

      expect(result.event_type).toBe('medication');
    });

    test('should classify "Tylenol" as medication', async () => {
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

      const result = await parseTextWithGemini('took Tylenol 500mg', 'test-api-key');

      expect(result.event_type).toBe('medication');
    });

    test('should classify "Metformin" as medication (prescription)', async () => {
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

      expect(result.event_type).toBe('medication');
    });
  });

  describe('Other event types remain functional', () => {
    test('should still classify sauna visits correctly', async () => {
      const mockResponse = {
        event_type: 'sauna',
        event_data: {
          duration: 20,
          temperature: 180,
          temperature_units: 'F'
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

      const result = await parseTextWithGemini('20 minute sauna at 180 degrees', 'test-api-key');

      expect(result.event_type).toBe('sauna');
      expect(result.event_data.duration).toBe(20);
      expect(result.event_data.temperature).toBe(180);
    });

    test('should still classify glucose readings correctly', async () => {
      const mockResponse = {
        event_type: 'glucose',
        event_data: {
          value: '105',
          units: 'mg/dL'
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

      const result = await parseTextWithGemini('glucose 105', 'test-api-key');

      expect(result.event_type).toBe('glucose');
      expect(result.event_data.value).toBe('105');
    });

    test('should still classify insulin correctly', async () => {
      const mockResponse = {
        event_type: 'insulin',
        event_data: {
          value: '10',
          units: 'units',
          insulin_type: 'rapid'
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

      const result = await parseTextWithGemini('took 10 units rapid insulin', 'test-api-key');

      expect(result.event_type).toBe('insulin');
      expect(result.event_data.value).toBe('10');
    });

    test('should still classify activity correctly', async () => {
      const mockResponse = {
        event_type: 'activity',
        event_data: {
          activity_type: 'run',
          duration: 30,
          intensity: 'moderate'
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

      const result = await parseTextWithGemini('30 minute run', 'test-api-key');

      expect(result.event_type).toBe('activity');
      expect(result.event_data.activity_type).toBe('run');
    });

    test('should still classify symptoms correctly', async () => {
      const mockResponse = {
        event_type: 'symptom',
        event_data: {
          description: 'headache',
          severity: 'moderate'
        },
        confidence: 90
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

      const result = await parseTextWithGemini('moderate headache', 'test-api-key');

      expect(result.event_type).toBe('symptom');
      expect(result.event_data.description).toBe('headache');
    });
  });

  describe('Edge cases and ambiguous items', () => {
    test('should handle "energy drink" as food', async () => {
      const mockResponse = {
        event_type: 'food',
        event_data: {
          description: 'Red Bull energy drink',
          calories: 110
        },
        confidence: 85
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

      const result = await parseTextWithGemini('had Red Bull', 'test-api-key');

      expect(result.event_type).toBe('food');
    });

    test('should handle "meal replacement shake" context-appropriately', async () => {
      // Could be food (if Soylent-style meal) or supplement (if protein powder)
      const mockResponse = {
        event_type: 'food',
        event_data: {
          description: 'Meal replacement shake',
          calories: 400
        },
        confidence: 80
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

      const result = await parseTextWithGemini('had meal replacement shake', 'test-api-key');

      // Accept either food or supplement as valid
      expect(['food', 'supplement']).toContain(result.event_type);
    });

    test('should include product_catalog_id field for food events', async () => {
      const mockResponse = {
        event_type: 'food',
        event_data: {
          description: 'Banana',
          calories: 105,
          product_catalog_id: '12345678-1234-1234-1234-123456789012'
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

      const result = await parseTextWithGemini('ate banana', 'test-api-key');

      expect(result.event_data.product_catalog_id).toBeDefined();
    });

    test('should include product_catalog_id field for supplement events', async () => {
      const mockResponse = {
        event_type: 'supplement',
        event_data: {
          name: 'Vitamin C',
          dosage: '1000',
          units: 'mg',
          product_catalog_id: '12345678-1234-1234-1234-123456789012'
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

      const result = await parseTextWithGemini('took 1000mg Vitamin C', 'test-api-key');

      expect(result.event_data.product_catalog_id).toBeDefined();
    });

    test('should include product_catalog_id field for medication events', async () => {
      const mockResponse = {
        event_type: 'medication',
        event_data: {
          name: 'Aspirin',
          dosage: '81',
          units: 'mg',
          product_catalog_id: '12345678-1234-1234-1234-123456789012'
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

      const result = await parseTextWithGemini('took 81mg aspirin', 'test-api-key');

      expect(result.event_data.product_catalog_id).toBeDefined();
    });
  });
});
