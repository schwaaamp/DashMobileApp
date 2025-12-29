/**
 * Product Catalog Tests
 *
 * Tests for product search, barcode lookup, and photo submission functionality.
 */

import {
  searchProductCatalog,
  lookupByBarcode,
  submitProductPhoto,
  extractNutritionLabel,
  incrementProductUsage,
  detectBarcode
} from '@/utils/productCatalog';
import { supabase } from '@/utils/supabaseClient';
import * as FileSystem from 'expo-file-system/legacy';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('expo-file-system/legacy');
jest.mock('@/utils/productRegistry', () => ({
  normalizeProductKey: jest.fn((name) => name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()),
  addToUserRegistry: jest.fn(() => Promise.resolve())
}));

describe('Product Catalog', () => {
  const mockUserId = 'test-user-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Default FileSystem mock
    FileSystem.readAsStringAsync = jest.fn(() => Promise.resolve('base64string'));
  });

  describe('searchProductCatalog', () => {
    it('should search by product name and return results sorted by popularity', async () => {
      const mockResults = [
        {
          id: '1',
          product_name: 'Banana',
          brand: 'Generic',
          times_logged: 150,
          calories: 105
        },
        {
          id: '2',
          product_name: 'Banana Bread',
          brand: 'Starbucks',
          times_logged: 50,
          calories: 420
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: mockResults, error: null }))
            }))
          }))
        }))
      }));

      const results = await searchProductCatalog('banana', mockUserId);

      expect(results).toHaveLength(2);
      expect(results[0].product_name).toBe('Banana');
      expect(results[0].times_logged).toBe(150);  // Most popular first
    });

    it('should search by brand name', async () => {
      const mockResults = [
        {
          id: '3',
          product_name: 'Oats & Honey Granola Bar',
          brand: 'Nature Valley',
          times_logged: 75
        }
      ];

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: mockResults, error: null }))
            }))
          }))
        }))
      }));

      const results = await searchProductCatalog('Nature Valley', mockUserId);

      expect(results).toHaveLength(1);
      expect(results[0].brand).toBe('Nature Valley');
    });

    it('should return empty array if no matches found', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          }))
        }))
      }));

      const results = await searchProductCatalog('NonexistentProduct123', mockUserId);

      expect(results).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({
                data: null,
                error: { code: 'DATABASE_ERROR', message: 'Connection failed' }
              }))
            }))
          }))
        }))
      }));

      const results = await searchProductCatalog('banana', mockUserId);

      expect(results).toEqual([]);  // Graceful degradation
    });

    it('should return empty array for empty query', async () => {
      const results = await searchProductCatalog('', mockUserId);
      expect(results).toEqual([]);
    });

    it('should limit results to specified count', async () => {
      const mockResults = Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        product_name: `Product ${i}`,
        times_logged: 10 - i
      }));

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn((count) => {
                return Promise.resolve({ data: mockResults.slice(0, count), error: null });
              })
            }))
          }))
        }))
      }));

      const results = await searchProductCatalog('Product', mockUserId, 3);

      expect(results).toHaveLength(3);
    });
  });

  describe('lookupByBarcode', () => {
    it('should return product data for valid barcode', async () => {
      const mockProduct = {
        id: 'product-123',
        barcode: '012345678901',
        product_name: 'Banana',
        brand: 'Chiquita',
        calories: 105
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
          }))
        }))
      }));

      // Mock increment function
      supabase.rpc = jest.fn(() => Promise.resolve({}));

      const result = await lookupByBarcode('012345678901');

      expect(result).toEqual(mockProduct);
      expect(result.barcode).toBe('012345678901');
    });

    it('should return null for unknown barcode', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: 'PGRST116', message: 'No rows found' }
            }))
          }))
        }))
      }));

      const result = await lookupByBarcode('999999999999');

      expect(result).toBeNull();
    });

    it('should increment times_logged when barcode is found', async () => {
      const mockProduct = {
        id: 'product-123',
        barcode: '012345678901',
        product_name: 'Banana'
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
          }))
        }))
      }));

      const mockRpc = jest.fn(() => Promise.resolve({}));
      supabase.rpc = mockRpc;

      await lookupByBarcode('012345678901');

      // Should attempt to increment
      expect(mockRpc).toHaveBeenCalledWith('increment_product_times_logged', {
        product_id: 'product-123'
      });
    });

    it('should return null for null barcode', async () => {
      const result = await lookupByBarcode(null);
      expect(result).toBeNull();
    });
  });

  describe('extractNutritionLabel', () => {
    beforeEach(() => {
      // Mock FileSystem for base64 encoding
      FileSystem.readAsStringAsync = jest.fn(() => Promise.resolve('base64encodedimage'));
      FileSystem.EncodingType = { Base64: 'base64' };
    });

    it('should extract nutrition data from clear label photo', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                product_name: 'Nature Valley Oats & Honey',
                brand: 'General Mills',
                barcode: '016000275447',
                product_type: 'food',
                serving_quantity: 1,
                serving_unit: 'bar',
                serving_weight_grams: 42,
                calories: 190,
                protein: 4,
                carbs: 29,
                fat: 7,
                fiber: 2,
                sugar: 11,
                micros: {},
                active_ingredients: [],
                confidence: 95
              })
            }]
          }
        }]
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGeminiResponse)
        })
      );

      const result = await extractNutritionLabel('/path/to/label.jpg', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.data.product_name).toBe('Nature Valley Oats & Honey');
      expect(result.data.serving_quantity).toBe(1);
      expect(result.data.serving_unit).toBe('bar');
      expect(result.data.serving_weight_grams).toBe(42);
      expect(result.data.calories).toBe(190);
      expect(result.data.confidence).toBe(95);
    });

    it('should return low confidence for blurry photos', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                product_name: 'Unknown Product',
                brand: null,
                barcode: null,
                product_type: 'food',
                serving_quantity: null,
                serving_unit: null,
                serving_weight_grams: null,
                calories: null,
                protein: null,
                carbs: null,
                fat: null,
                fiber: null,
                sugar: null,
                micros: {},
                active_ingredients: [],
                confidence: 35
              })
            }]
          }
        }]
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGeminiResponse)
        })
      );

      const result = await extractNutritionLabel('/path/to/blurry.jpg', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.data.confidence).toBeLessThan(70);
    });

    it('should handle missing fields gracefully (set to null)', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                product_name: 'Partial Label',
                brand: null,
                barcode: null,
                product_type: 'food',
                serving_quantity: 1,
                serving_unit: 'cup',
                serving_weight_grams: null,  // Missing weight
                calories: 250,
                protein: null,  // Missing
                carbs: 30,
                fat: null,  // Missing
                fiber: null,
                sugar: null,
                micros: {},
                active_ingredients: [],
                confidence: 75
              })
            }]
          }
        }]
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGeminiResponse)
        })
      );

      const result = await extractNutritionLabel('/path/to/partial.jpg', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.data.protein).toBeNull();
      expect(result.data.fat).toBeNull();
      expect(result.data.serving_weight_grams).toBeNull();
    });

    it('should parse serving_size into quantity, unit, and grams', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                product_name: 'Greek Yogurt',
                brand: 'Fage',
                barcode: '052159405007',
                product_type: 'food',
                serving_quantity: 1,
                serving_unit: 'container',
                serving_weight_grams: 170,
                calories: 100,
                protein: 18,
                carbs: 7,
                fat: 0,
                fiber: 0,
                sugar: 6,
                micros: {
                  calcium: { amount: 150, unit: 'mg' }
                },
                active_ingredients: [],
                confidence: 92
              })
            }]
          }
        }]
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGeminiResponse)
        })
      );

      const result = await extractNutritionLabel('/path/to/yogurt.jpg', 'test-api-key');

      expect(result.data.serving_quantity).toBe(1);
      expect(result.data.serving_unit).toBe('container');
      expect(result.data.serving_weight_grams).toBe(170);
    });

    it('should handle multi-ingredient medications (JSONB array)', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                product_name: 'NyQuil Cold & Flu',
                brand: 'Vicks',
                barcode: '323900039056',
                product_type: 'medication',
                serving_quantity: 2,
                serving_unit: 'tablespoons',
                serving_weight_grams: 30,
                calories: 0,
                protein: 0,
                carbs: 0,
                fat: 0,
                fiber: 0,
                sugar: 0,
                micros: {},
                active_ingredients: [
                  { name: 'Acetaminophen', strength: '650mg' },
                  { name: 'Dextromethorphan HBr', strength: '30mg' },
                  { name: 'Doxylamine Succinate', strength: '12.5mg' }
                ],
                confidence: 88
              })
            }]
          }
        }]
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGeminiResponse)
        })
      );

      const result = await extractNutritionLabel('/path/to/nyquil.jpg', 'test-api-key');

      expect(result.data.active_ingredients).toHaveLength(3);
      expect(result.data.active_ingredients[0].name).toBe('Acetaminophen');
      expect(result.data.active_ingredients[1].name).toBe('Dextromethorphan HBr');
      expect(result.data.active_ingredients[2].name).toBe('Doxylamine Succinate');
    });

    it('should handle Gemini API errors', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error')
        })
      );

      const result = await extractNutritionLabel('/path/to/label.jpg', 'test-api-key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Gemini API error');
    });
  });

  describe('submitProductPhoto', () => {
    beforeEach(() => {
      // Mock Supabase Storage
      supabase.storage = {
        from: jest.fn(() => ({
          upload: jest.fn(() => Promise.resolve({ data: { path: 'uploads/front.jpg' }, error: null })),
          getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://storage.url/front.jpg' } }))
        }))
      };

      // Mock product_catalog insert
      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: { id: 'new-product-123', product_name: 'Test Product' },
                  error: null
                }))
              }))
            })),
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              }))
            }))
          };
        } else if (table === 'product_submissions') {
          return {
            insert: jest.fn(() => Promise.resolve({ data: { id: 'submission-123' }, error: null }))
          };
        }
        return {};
      });

      // Mock Gemini extraction
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    product_name: 'Test Product',
                    brand: 'Test Brand',
                    barcode: '123456789012',
                    product_type: 'food',
                    serving_quantity: 1,
                    serving_unit: 'bar',
                    serving_weight_grams: 50,
                    calories: 200,
                    protein: 5,
                    carbs: 25,
                    fat: 8,
                    fiber: 3,
                    sugar: 10,
                    micros: {},
                    active_ingredients: [],
                    confidence: 85
                  })
                }]
              }
            }]
          })
        })
      );
    });

    it('should upload both photos to Supabase Storage', async () => {
      const result = await submitProductPhoto(
        '/path/to/front.jpg',
        '/path/to/label.jpg',
        mockUserId,
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(supabase.storage.from).toHaveBeenCalled();
    });

    it('should call extractNutritionLabel and insert into product_catalog', async () => {
      const result = await submitProductPhoto(
        '/path/to/front.jpg',
        '/path/to/label.jpg',
        mockUserId,
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.productId).toBe('new-product-123');
    });

    it('should reject duplicate submissions (existing barcode)', async () => {
      // Mock existing product lookup
      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: { id: 'existing-123', product_name: 'Existing Product' },
                  error: null
                }))
              }))
            }))
          };
        } else if (table === 'product_submissions') {
          return {
            insert: jest.fn(() => Promise.resolve({ data: null, error: null }))
          };
        }
        return {};
      });

      const result = await submitProductPhoto(
        '/path/to/front.jpg',
        '/path/to/label.jpg',
        mockUserId,
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.isDuplicate).toBe(true);
      expect(result.existingProduct.id).toBe('existing-123');
    });

    it('should handle low confidence OCR (< 70%)', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    product_name: 'Unclear Product',
                    brand: null,
                    barcode: null,
                    product_type: 'food',
                    serving_quantity: null,
                    serving_unit: null,
                    serving_weight_grams: null,
                    calories: null,
                    protein: null,
                    carbs: null,
                    fat: null,
                    fiber: null,
                    sugar: null,
                    micros: {},
                    active_ingredients: [],
                    confidence: 45  // Low confidence
                  })
                }]
              }
            }]
          })
        })
      );

      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'submission-456' },
              error: null
            }))
          }))
        }))
      }));

      const result = await submitProductPhoto(
        '/path/to/front.jpg',
        '/path/to/label.jpg',
        mockUserId,
        'test-api-key'
      );

      expect(result.success).toBe(false);
      expect(result.needsManualReview).toBe(true);
      expect(result.error).toContain('Low confidence OCR');
    });
  });

  describe('incrementProductUsage', () => {
    it('should increment times_logged counter via RPC', async () => {
      const mockRpc = jest.fn(() => Promise.resolve({}));
      supabase.rpc = mockRpc;

      await incrementProductUsage('product-123');

      expect(mockRpc).toHaveBeenCalledWith('increment_product_times_logged', {
        product_id: 'product-123'
      });
    });

    it('should fallback to manual increment if RPC fails', async () => {
      supabase.rpc = jest.fn(() => Promise.reject(new Error('RPC not found')));

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { times_logged: 5 },
              error: null
            }))
          }))
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null }))
        }))
      }));

      await incrementProductUsage('product-123');

      // Should have attempted fallback
      expect(supabase.from).toHaveBeenCalledWith('product_catalog');
    });

    it('should handle non-existent product IDs gracefully', async () => {
      supabase.rpc = jest.fn(() => Promise.reject(new Error('RPC not found')));

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: 'PGRST116' }
            }))
          }))
        }))
      }));

      // Should not throw
      await expect(incrementProductUsage('nonexistent-id')).resolves.not.toThrow();
    });
  });

  describe('detectBarcode', () => {
    beforeEach(() => {
      // Mock FileSystem for base64 encoding
      FileSystem.readAsStringAsync = jest.fn(() => Promise.resolve('base64encodedimage'));
      FileSystem.EncodingType = { Base64: 'base64' };
    });

    it('should detect UPC barcodes', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    barcode: '012345678901',
                    format: 'UPC-A',
                    confidence: 95
                  })
                }]
              }
            }]
          })
        })
      );

      const result = await detectBarcode('/path/to/photo.jpg', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.barcode).toBe('012345678901');
      expect(result.format).toBe('UPC-A');
      expect(result.confidence).toBe(95);
    });

    it('should detect EAN barcodes', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    barcode: '5901234123457',
                    format: 'EAN-13',
                    confidence: 90
                  })
                }]
              }
            }]
          })
        })
      );

      const result = await detectBarcode('/path/to/photo.jpg', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.barcode).toBe('5901234123457');
      expect(result.format).toBe('EAN-13');
    });

    it('should return null for photos without barcodes', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    barcode: null,
                    format: null,
                    confidence: 0
                  })
                }]
              }
            }]
          })
        })
      );

      const result = await detectBarcode('/path/to/apple.jpg', 'test-api-key');

      expect(result.success).toBe(false);
      expect(result.barcode).toBeNull();
    });

    it('should handle Gemini API errors', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500
        })
      );

      const result = await detectBarcode('/path/to/photo.jpg', 'test-api-key');

      expect(result.success).toBe(false);
      expect(result.barcode).toBeNull();
    });
  });
});
