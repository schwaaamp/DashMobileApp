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
  detectBarcode,
  validateBarcode,
  addBarcodeToProduct,
  addProductToCatalog,
  checkBarcodeConflict
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
    it('should return product data for valid barcode via product_barcodes table', async () => {
      const mockProduct = {
        id: 'product-123',
        product_name: 'Banana',
        brand: 'Chiquita',
        calories: 105
      };

      const mockBarcodeRecord = {
        barcode: '012345678901',
        total_quantity: 1,
        total_unit: 'each',
        container_type: null,
        needs_reverification: false,
        last_scanned_at: '2025-01-01T00:00:00Z',
        product: mockProduct
      };

      // Mock chained calls for product_barcodes lookup
      const mockUpdateEq = jest.fn(() => Promise.resolve({ error: null }));
      const mockUpdate = jest.fn(() => ({ eq: mockUpdateEq }));
      const mockSingle = jest.fn(() => Promise.resolve({ data: mockBarcodeRecord, error: null }));
      const mockEq = jest.fn(() => ({ single: mockSingle }));
      const mockSelect = jest.fn(() => ({ eq: mockEq }));

      supabase.from = jest.fn((table) => {
        if (table === 'product_barcodes') {
          return { select: mockSelect, update: mockUpdate };
        }
        // Fallback for product_catalog (legacy)
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
            }))
          }))
        };
      });

      // Mock increment function
      supabase.rpc = jest.fn(() => Promise.resolve({}));

      const result = await lookupByBarcode('012345678901');

      expect(result).not.toBeNull();
      expect(result.barcode).toBe('012345678901');
      expect(result.product_name).toBe('Banana');
      expect(result.matchMethod).toBe('barcode');
    });

    it('should return null for unknown barcode', async () => {
      // Mock product_barcodes returning no match
      const mockSingle = jest.fn(() => Promise.resolve({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' }
      }));
      const mockEq = jest.fn(() => ({ single: mockSingle }));
      const mockSelect = jest.fn(() => ({ eq: mockEq }));

      supabase.from = jest.fn(() => ({
        select: mockSelect
      }));

      const result = await lookupByBarcode('999999999999');

      expect(result).toBeNull();
    });

    it('should increment times_logged when barcode is found', async () => {
      const mockProduct = {
        id: 'product-123',
        product_name: 'Banana'
      };

      const mockBarcodeRecord = {
        barcode: '012345678901',
        total_quantity: 1,
        total_unit: 'each',
        container_type: null,
        needs_reverification: false,
        last_scanned_at: '2025-01-01T00:00:00Z',
        product: mockProduct
      };

      const mockUpdateEq = jest.fn(() => Promise.resolve({ error: null }));
      const mockUpdate = jest.fn(() => ({ eq: mockUpdateEq }));
      const mockSingle = jest.fn(() => Promise.resolve({ data: mockBarcodeRecord, error: null }));
      const mockEq = jest.fn(() => ({ single: mockSingle }));
      const mockSelect = jest.fn(() => ({ eq: mockEq }));

      supabase.from = jest.fn((table) => {
        if (table === 'product_barcodes') {
          return { select: mockSelect, update: mockUpdate };
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
            }))
          }))
        };
      });

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

    it('should reject Amazon FNSKU barcodes', async () => {
      const result = await lookupByBarcode('X00ABC1234');

      expect(result).not.toBeNull();
      expect(result.error).toBe(true);
      expect(result.reason).toBe('amazon_fnsku');
    });

    it('should reject Amazon LPN barcodes', async () => {
      const result = await lookupByBarcode('LPN12345678');

      expect(result).not.toBeNull();
      expect(result.error).toBe(true);
      expect(result.reason).toBe('amazon_lpn');
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
      // Mock existing product lookup via product_barcodes table
      const mockExistingProduct = { id: 'existing-123', product_name: 'Existing Product' };
      const mockBarcodeRecord = {
        barcode: '123456789012',
        total_quantity: 1,
        total_unit: 'bar',
        container_type: null,
        needs_reverification: false,
        last_scanned_at: '2025-01-01T00:00:00Z',
        product: mockExistingProduct
      };

      const mockUpdateEq = jest.fn(() => Promise.resolve({ error: null }));
      const mockUpdate = jest.fn(() => ({ eq: mockUpdateEq }));

      supabase.from = jest.fn((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockBarcodeRecord, error: null }))
              }))
            })),
            update: mockUpdate
          };
        } else if (table === 'product_catalog') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
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

      // Mock increment function
      supabase.rpc = jest.fn(() => Promise.resolve({}));

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

  describe('validateBarcode', () => {
    it('should accept valid UPC-A (12 digits)', () => {
      const result = validateBarcode('012345678901');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('012345678901');
      expect(result.format).toBe('UPC-A');
    });

    it('should accept valid EAN-13 (13 digits)', () => {
      const result = validateBarcode('5901234123457');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('5901234123457');
      expect(result.format).toBe('EAN-13');
    });

    it('should accept valid UPC-E (8 digits)', () => {
      const result = validateBarcode('01234565');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('01234565');
      expect(result.format).toBe('UPC-E');
    });

    it('should reject Amazon FNSKU codes (X00 prefix)', () => {
      const result = validateBarcode('X00ABC1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('amazon_fnsku');
      expect(result.message).toContain('Amazon FNSKU');
    });

    it('should reject Amazon LPN codes', () => {
      const result = validateBarcode('LPN12345678');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('amazon_lpn');
      expect(result.message).toContain('Amazon warehouse');
    });

    it('should reject unknown barcode formats', () => {
      const result = validateBarcode('12345');  // 5 digits - not a standard format
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('unknown_format');
      expect(result.message).toContain('5 digits');
    });

    it('should handle null/undefined input', () => {
      expect(validateBarcode(null).valid).toBe(false);
      expect(validateBarcode(undefined).valid).toBe(false);
      expect(validateBarcode('').valid).toBe(false);
    });

    it('should normalize barcodes with spaces or dashes', () => {
      const result = validateBarcode('012-345-678901');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('012345678901');
    });

    it('should be case-insensitive for Amazon codes', () => {
      expect(validateBarcode('x00abc1234').valid).toBe(false);
      expect(validateBarcode('lpn12345678').valid).toBe(false);
    });
  });

  describe('addBarcodeToProduct', () => {
    const mockUserId = 'test-user-123';
    const mockProductId = 'product-uuid-123';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully add a valid barcode to an existing product', async () => {
      const mockBarcodeRecord = {
        barcode: '012345678901',
        product_id: mockProductId,
        total_quantity: 90,
        total_unit: 'capsules',
        container_type: 'bottle'
      };

      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockBarcodeRecord, error: null }))
          }))
        }))
      }));

      const result = await addBarcodeToProduct(
        '012345678901',
        mockProductId,
        { quantity: 90, unit: 'capsules', containerType: 'bottle' },
        mockUserId
      );

      expect(result.success).toBe(true);
      expect(result.barcodeRecord).toEqual(mockBarcodeRecord);
    });

    it('should reject invalid barcode formats', async () => {
      const result = await addBarcodeToProduct(
        'X00FNSKU123',  // Amazon FNSKU
        mockProductId,
        { quantity: 90, unit: 'capsules' },
        mockUserId
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Amazon FNSKU');
    });

    it('should handle duplicate barcode error (already registered)', async () => {
      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value' }
            }))
          }))
        }))
      }));

      const result = await addBarcodeToProduct(
        '012345678901',
        mockProductId,
        { quantity: 90, unit: 'capsules' },
        mockUserId
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });

    it('should handle database errors gracefully', async () => {
      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: 'UNKNOWN', message: 'Database connection failed' }
            }))
          }))
        }))
      }));

      const result = await addBarcodeToProduct(
        '012345678901',
        mockProductId,
        { quantity: 90, unit: 'capsules' },
        mockUserId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle missing packaging info gracefully', async () => {
      const mockBarcodeRecord = {
        barcode: '012345678901',
        product_id: mockProductId,
        total_quantity: null,
        total_unit: null,
        container_type: null
      };

      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockBarcodeRecord, error: null }))
          }))
        }))
      }));

      const result = await addBarcodeToProduct(
        '012345678901',
        mockProductId,
        null,  // No packaging info
        mockUserId
      );

      expect(result.success).toBe(true);
    });
  });

  describe('addProductToCatalog', () => {
    const mockUserId = 'test-user-123';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should add product to catalog and barcode to product_barcodes', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement'
      };

      const mockInsertSelect = jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
      }));
      const mockBarcodeInsert = jest.fn(() => Promise.resolve({ error: null }));

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: mockInsertSelect
            }))
          };
        } else if (table === 'product_barcodes') {
          return {
            insert: mockBarcodeInsert
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement',
        serving_quantity: 3,
        serving_unit: 'capsules',
        barcode: '733739021427',
        package_quantity: 90
      }, mockUserId);

      expect(result.success).toBe(true);
      expect(result.product.id).toBe('new-product-123');

      // Verify both tables were called
      expect(supabase.from).toHaveBeenCalledWith('product_catalog');
      expect(supabase.from).toHaveBeenCalledWith('product_barcodes');
    });

    it('should skip barcode insertion if barcode is invalid (Amazon FNSKU)', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'supplement'
      };

      let barcodeInsertCalled = false;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          barcodeInsertCalled = true;
          return {
            insert: jest.fn(() => Promise.resolve({ error: null }))
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'supplement',
        barcode: 'X00FNSKU123'  // Invalid Amazon barcode
      }, mockUserId);

      expect(result.success).toBe(true);
      // Product should be created, but barcode insert should NOT be called
      expect(barcodeInsertCalled).toBe(false);
    });

    it('should succeed even if barcode insertion fails (non-blocking)', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'supplement'
      };

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          return {
            insert: jest.fn(() => Promise.resolve({
              error: { code: '23505', message: 'duplicate key' }
            }))
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'supplement',
        barcode: '012345678901'
      }, mockUserId);

      // Product creation should still succeed even if barcode insert fails
      expect(result.success).toBe(true);
      expect(result.product.id).toBe('new-product-123');
    });

    it('should handle product insertion failure', async () => {
      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate product_key' }
            }))
          }))
        }))
      }));

      const result = await addProductToCatalog({
        product_name: 'Existing Product',
        brand: 'Test Brand',
        product_type: 'supplement'
      }, mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should add product without barcode if none provided', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Generic Product',
        brand: null,
        product_type: 'food'
      };

      let barcodeInsertCalled = false;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          barcodeInsertCalled = true;
          return {
            insert: jest.fn(() => Promise.resolve({ error: null }))
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Generic Product',
        product_type: 'food'
        // No barcode provided
      }, mockUserId);

      expect(result.success).toBe(true);
      expect(barcodeInsertCalled).toBe(false);
    });

    it('should skip barcode insertion for empty string barcode', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'food'
      };

      let barcodeInsertCalled = false;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          barcodeInsertCalled = true;
          return {
            insert: jest.fn(() => Promise.resolve({ error: null }))
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'food',
        barcode: ''  // Empty string
      }, mockUserId);

      expect(result.success).toBe(true);
      expect(barcodeInsertCalled).toBe(false);
    });

    it('should skip barcode insertion for Amazon LPN codes', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'supplement'
      };

      let barcodeInsertCalled = false;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          barcodeInsertCalled = true;
          return {
            insert: jest.fn(() => Promise.resolve({ error: null }))
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'supplement',
        barcode: 'LPN12345678'  // Amazon LPN code
      }, mockUserId);

      expect(result.success).toBe(true);
      // Product should be created, but barcode insert should NOT be called
      expect(barcodeInsertCalled).toBe(false);
    });

    it('should accept and normalize EAN-13 barcodes (13 digits)', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'European Product',
        brand: 'EU Brand',
        product_type: 'food'
      };

      let capturedBarcodePayload = null;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          return {
            insert: jest.fn((payload) => {
              capturedBarcodePayload = payload;
              return Promise.resolve({ error: null });
            })
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'European Product',
        brand: 'EU Brand',
        product_type: 'food',
        barcode: '5901234123457',  // EAN-13
        package_quantity: 1
      }, mockUserId);

      expect(result.success).toBe(true);
      expect(capturedBarcodePayload).not.toBeNull();
      expect(capturedBarcodePayload.barcode).toBe('5901234123457');
    });

    it('should accept and normalize UPC-E barcodes (8 digits)', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Compact Product',
        brand: 'Small Brand',
        product_type: 'food'
      };

      let capturedBarcodePayload = null;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          return {
            insert: jest.fn((payload) => {
              capturedBarcodePayload = payload;
              return Promise.resolve({ error: null });
            })
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Compact Product',
        brand: 'Small Brand',
        product_type: 'food',
        barcode: '01234565',  // UPC-E (8 digits)
        package_quantity: 1
      }, mockUserId);

      expect(result.success).toBe(true);
      expect(capturedBarcodePayload).not.toBeNull();
      expect(capturedBarcodePayload.barcode).toBe('01234565');
    });

    it('should normalize barcodes with spaces and dashes', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'food'
      };

      let capturedBarcodePayload = null;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          return {
            insert: jest.fn((payload) => {
              capturedBarcodePayload = payload;
              return Promise.resolve({ error: null });
            })
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'food',
        barcode: '012-345-678901',  // Barcode with dashes
        package_quantity: 6
      }, mockUserId);

      expect(result.success).toBe(true);
      expect(capturedBarcodePayload).not.toBeNull();
      expect(capturedBarcodePayload.barcode).toBe('012345678901');  // Normalized
    });

    it('should send correct payload to product_barcodes table', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement'
      };

      let capturedBarcodePayload = null;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          return {
            insert: jest.fn((payload) => {
              capturedBarcodePayload = payload;
              return Promise.resolve({ error: null });
            })
          };
        }
        return {};
      });

      await addProductToCatalog({
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement',
        serving_quantity: 3,
        serving_unit: 'capsules',
        barcode: '733739021427',
        package_quantity: 90
      }, mockUserId);

      // Verify barcode payload structure
      expect(capturedBarcodePayload).toEqual({
        barcode: '733739021427',
        product_id: 'new-product-123',
        total_quantity: 90,
        total_unit: 'capsules',
        submitted_by_user_id: mockUserId
      });
    });

    it('should reject unknown barcode format (wrong digit count)', async () => {
      const mockProduct = {
        id: 'new-product-123',
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'food'
      };

      let barcodeInsertCalled = false;

      supabase.from = jest.fn((table) => {
        if (table === 'product_catalog') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockProduct, error: null }))
              }))
            }))
          };
        } else if (table === 'product_barcodes') {
          barcodeInsertCalled = true;
          return {
            insert: jest.fn(() => Promise.resolve({ error: null }))
          };
        }
        return {};
      });

      const result = await addProductToCatalog({
        product_name: 'Test Product',
        brand: 'Test Brand',
        product_type: 'food',
        barcode: '12345'  // Only 5 digits - invalid
      }, mockUserId);

      expect(result.success).toBe(true);  // Product still created
      expect(barcodeInsertCalled).toBe(false);  // But barcode skipped
    });
  });

  describe('Barcode Architecture - Multi-Size & Multipack Scenarios', () => {
    /**
     * Case 1: Multiple Sizes, One Product
     * 90-count and 180-count bottles should link to same product_id
     * but have different total_quantity in product_barcodes
     */
    it('should link multiple barcode sizes to same product (90ct vs 180ct)', async () => {
      const sharedProductId = 'product-magtein-123';
      const mockProduct = {
        id: sharedProductId,
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement',
        serving_quantity: 3,
        serving_unit: 'capsules'
      };

      // First scan: 90-count bottle
      const barcode90ct = {
        barcode: '733739021427',
        total_quantity: 90,
        total_unit: 'capsules',
        container_type: 'bottle',
        needs_reverification: false,
        last_scanned_at: '2025-01-15T00:00:00Z',
        product: mockProduct
      };

      // Second scan: 180-count bottle (different UPC, same product)
      const barcode180ct = {
        barcode: '733739021434',
        total_quantity: 180,
        total_unit: 'capsules',
        container_type: 'bottle',
        needs_reverification: false,
        last_scanned_at: '2025-01-15T00:00:00Z',
        product: mockProduct  // Same product!
      };

      // Mock lookups for both barcodes
      let currentBarcode = barcode90ct;

      supabase.from = jest.fn((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn((field, value) => {
                // Return different barcode record based on which UPC is queried
                if (value === '733739021427') currentBarcode = barcode90ct;
                if (value === '733739021434') currentBarcode = barcode180ct;
                return {
                  single: jest.fn(() => Promise.resolve({ data: currentBarcode, error: null }))
                };
              })
            })),
            update: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null }))
            }))
          };
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
            }))
          }))
        };
      });

      supabase.rpc = jest.fn(() => Promise.resolve({}));

      // Lookup 90-count
      const result90 = await lookupByBarcode('733739021427');
      expect(result90).not.toBeNull();
      expect(result90.id).toBe(sharedProductId);
      expect(result90.package_quantity).toBe(90);
      expect(result90.product_name).toBe('Magtein Magnesium L-Threonate');

      // Lookup 180-count
      const result180 = await lookupByBarcode('733739021434');
      expect(result180).not.toBeNull();
      expect(result180.id).toBe(sharedProductId);  // Same product_id!
      expect(result180.package_quantity).toBe(180);  // Different quantity
      expect(result180.product_name).toBe('Magtein Magnesium L-Threonate');

      // Both should share same nutritional data (from product_catalog)
      expect(result90.serving_quantity).toBe(result180.serving_quantity);
      expect(result90.serving_unit).toBe(result180.serving_unit);
    });

    /**
     * Case 2: Multipack vs Individual
     * A 12-pack box should identify container_type and multiplier
     * but calories/macros come from single item in parent catalog
     */
    it('should handle multipack (12-pack box) with correct container info', async () => {
      const mockProduct = {
        id: 'product-granola-456',
        product_name: 'Oats & Honey Granola Bar',
        brand: 'Nature Valley',
        product_type: 'food',
        serving_quantity: 1,
        serving_unit: 'bar',
        serving_weight_grams: 42,
        calories: 190,  // Per single bar
        protein: 4,
        carbs: 29,
        fat: 7
      };

      // 12-pack box barcode
      const barcode12Pack = {
        barcode: '016000264601',
        total_quantity: 12,
        total_unit: 'bars',
        container_type: 'box',
        needs_reverification: false,
        last_scanned_at: '2025-01-15T00:00:00Z',
        product: mockProduct
      };

      supabase.from = jest.fn((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: barcode12Pack, error: null }))
              }))
            })),
            update: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null }))
            }))
          };
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
            }))
          }))
        };
      });

      supabase.rpc = jest.fn(() => Promise.resolve({}));

      const result = await lookupByBarcode('016000264601');

      expect(result).not.toBeNull();
      expect(result.container_type).toBe('box');
      expect(result.package_quantity).toBe(12);  // 12 bars in box
      expect(result.package_unit).toBe('bars');

      // Nutrition is per single bar (from product_catalog)
      expect(result.calories).toBe(190);
      expect(result.serving_quantity).toBe(1);
      expect(result.serving_unit).toBe('bar');
    });
  });

  describe('Barcode Architecture - Data Integrity & Staleness', () => {
    /**
     * Case 3: Outdated UPC Verification
     * Barcode not scanned in >24 months should flag needs_reverification
     */
    it('should return needs_reverification flag for stale barcodes', async () => {
      const mockProduct = {
        id: 'product-old-789',
        product_name: 'Some Old Product',
        brand: 'Old Brand',
        product_type: 'food'
      };

      // Barcode last scanned 25 months ago, flagged for reverification
      const staleBarcodeRecord = {
        barcode: '012345678901',
        total_quantity: 1,
        total_unit: 'each',
        container_type: null,
        needs_reverification: true,  // Flagged as stale
        last_scanned_at: '2023-01-15T00:00:00Z',  // >24 months old
        product: mockProduct
      };

      supabase.from = jest.fn((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: staleBarcodeRecord, error: null }))
              }))
            })),
            update: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null }))
            }))
          };
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
            }))
          }))
        };
      });

      supabase.rpc = jest.fn(() => Promise.resolve({}));

      const result = await lookupByBarcode('012345678901');

      expect(result).not.toBeNull();
      expect(result.needs_reverification).toBe(true);
      // UI layer should use this flag to prompt: "Has the label changed? Tap to verify nutrients."
    });

    /**
     * Case 4: Manual Search to Barcode Association
     * User searches product via text, then scans barcode to link
     * This tests addBarcodeToProduct functionality
     */
    it('should allow associating barcode with existing product found via text search', async () => {
      // Step 1: User finds product via text search (simulated by existing product)
      const existingProduct = {
        id: 'product-found-via-search',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement',
        serving_quantity: 3,
        serving_unit: 'capsules'
      };

      // Step 2: User scans barcode that doesn't exist yet
      const newBarcode = '733739099999';  // Not in database yet

      // Mock: barcode lookup returns null (not found)
      supabase.from = jest.fn((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: null,
                  error: { code: 'PGRST116', message: 'No rows found' }
                }))
              }))
            })),
            // For addBarcodeToProduct
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    barcode: newBarcode,
                    product_id: existingProduct.id,
                    total_quantity: 60,
                    total_unit: 'capsules',
                    container_type: 'bottle'
                  },
                  error: null
                }))
              }))
            }))
          };
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
            }))
          }))
        };
      });

      // Step 3: Barcode not found initially
      const lookupResult = await lookupByBarcode(newBarcode);
      expect(lookupResult).toBeNull();

      // Step 4: User chooses to link barcode to the product they found via search
      const linkResult = await addBarcodeToProduct(
        newBarcode,
        existingProduct.id,
        { quantity: 60, unit: 'capsules', containerType: 'bottle' },
        'user-123'
      );

      expect(linkResult.success).toBe(true);
      expect(linkResult.barcodeRecord.barcode).toBe(newBarcode);
      expect(linkResult.barcodeRecord.product_id).toBe(existingProduct.id);
      expect(linkResult.barcodeRecord.total_quantity).toBe(60);
    });

    /**
     * Edge Case: Prevent duplicate barcode registration
     * If barcode already exists for different product, should fail
     */
    it('should prevent registering barcode already linked to another product', async () => {
      const existingBarcode = '733739021427';  // Already in database

      supabase.from = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' }
            }))
          }))
        }))
      }));

      const result = await addBarcodeToProduct(
        existingBarcode,
        'different-product-id',
        { quantity: 90, unit: 'capsules' },
        'user-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });
  });

  describe('checkBarcodeConflict', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return no conflict when barcode does not exist in database', async () => {
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

      const result = await checkBarcodeConflict('012345678901', 'New Product', 'New Brand');

      expect(result.conflict).toBe(false);
    });

    it('should return no conflict for null or empty barcode', async () => {
      const resultNull = await checkBarcodeConflict(null, 'Product', 'Brand');
      expect(resultNull.conflict).toBe(false);

      const resultEmpty = await checkBarcodeConflict('', 'Product', 'Brand');
      expect(resultEmpty.conflict).toBe(false);
    });

    it('should return no conflict for invalid barcode format', async () => {
      // Amazon FNSKU - should be rejected before hitting database
      const result = await checkBarcodeConflict('X00ABC1234', 'Product', 'Brand');
      expect(result.conflict).toBe(false);
    });

    it('should return conflict when barcode is already flagged for reverification', async () => {
      const mockExisting = {
        last_scanned_at: '2025-01-01T00:00:00Z',
        needs_reverification: true,
        product: {
          product_name: 'Old Product',
          brand: 'Old Brand',
          product_type: 'food'
        }
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        }))
      }));

      const result = await checkBarcodeConflict('012345678901', 'New Product', 'New Brand');

      expect(result.conflict).toBe(true);
      expect(result.reason).toBe('previously_flagged');
      expect(result.existingProduct.product_name).toBe('Old Product');
    });

    it('should return no conflict for fresh barcode with matching name', async () => {
      // Last scanned 2 months ago - not stale
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

      const mockExisting = {
        last_scanned_at: twoMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Magtein Magnesium L-Threonate',
          brand: 'NOW Foods',
          product_type: 'supplement'
        }
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        }))
      }));

      const result = await checkBarcodeConflict('733739021427', 'Magtein', 'NOW');

      expect(result.conflict).toBe(false);
    });

    it('should detect stale food barcode with name mismatch (18 month threshold)', async () => {
      // Last scanned 20 months ago - stale for food
      const twentyMonthsAgo = new Date();
      twentyMonthsAgo.setMonth(twentyMonthsAgo.getMonth() - 20);

      const mockExisting = {
        last_scanned_at: twentyMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Old Granola Bar',
          brand: 'Nature Valley',
          product_type: 'food'  // 18 month threshold
        }
      };

      const mockUpdate = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null }))
      }));

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        })),
        update: mockUpdate
      }));

      const result = await checkBarcodeConflict(
        '016000264601',
        'New Energy Bar',  // Completely different name
        'Nature Valley'
      );

      expect(result.conflict).toBe(true);
      expect(result.reason).toBe('stale_with_mismatch');
      expect(result.suggestion).toContain('food product barcode may have been reassigned');
      expect(result.existingProduct.product_name).toBe('Old Granola Bar');
      expect(result.detectedProduct.name).toBe('New Energy Bar');

      // Should have flagged for reverification
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should use 36 month threshold for supplements (longer freshness)', async () => {
      // Last scanned 30 months ago - stale for food but NOT for supplements
      const thirtyMonthsAgo = new Date();
      thirtyMonthsAgo.setMonth(thirtyMonthsAgo.getMonth() - 30);

      const mockExisting = {
        last_scanned_at: thirtyMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Vitamin D3',
          brand: 'NOW Foods',
          product_type: 'supplement'  // 36 month threshold
        }
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        }))
      }));

      // Same product, just 30 months old - should NOT conflict for supplements
      const result = await checkBarcodeConflict('733739021427', 'Vitamin D3', 'NOW Foods');

      expect(result.conflict).toBe(false);
    });

    it('should detect stale supplement barcode after 36 month threshold', async () => {
      // Last scanned 40 months ago - stale for supplements
      const fortyMonthsAgo = new Date();
      fortyMonthsAgo.setMonth(fortyMonthsAgo.getMonth() - 40);

      const mockExisting = {
        last_scanned_at: fortyMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Old Vitamin D',
          brand: 'NOW Foods',
          product_type: 'supplement'
        }
      };

      const mockUpdate = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null }))
      }));

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        })),
        update: mockUpdate
      }));

      const result = await checkBarcodeConflict(
        '733739021427',
        'Magnesium Citrate',  // Different product
        'NOW Foods'
      );

      expect(result.conflict).toBe(true);
      expect(result.reason).toBe('stale_with_mismatch');
      expect(result.suggestion).toContain('Product name mismatch detected');
    });

    it('should detect brand mismatch on stale barcode', async () => {
      // Last scanned 24 months ago - stale for food
      const twentyFourMonthsAgo = new Date();
      twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);

      const mockExisting = {
        last_scanned_at: twentyFourMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Oats & Honey Bar',
          brand: 'Nature Valley',
          product_type: 'food'
        }
      };

      const mockUpdate = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null }))
      }));

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        })),
        update: mockUpdate
      }));

      // Same-ish product name but DIFFERENT brand
      const result = await checkBarcodeConflict(
        '016000264601',
        'Oats & Honey Bar',
        'Quaker'  // Different brand!
      );

      expect(result.conflict).toBe(true);
      expect(result.reason).toBe('stale_with_mismatch');
    });

    it('should NOT flag conflict when names are similar (substring match)', async () => {
      // Last scanned 24 months ago - stale for food
      const twentyFourMonthsAgo = new Date();
      twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);

      const mockExisting = {
        last_scanned_at: twentyFourMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Magtein Magnesium L-Threonate',
          brand: 'NOW Foods',
          product_type: 'supplement'
        }
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        }))
      }));

      // Short form "Magtein" should match "Magtein Magnesium L-Threonate"
      const result = await checkBarcodeConflict('733739021427', 'Magtein', 'NOW');

      expect(result.conflict).toBe(false);
    });

    it('should handle database errors gracefully (return no conflict)', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: 'UNKNOWN_ERROR', message: 'Database connection failed' }
            }))
          }))
        }))
      }));

      const result = await checkBarcodeConflict('012345678901', 'Product', 'Brand');

      // Should gracefully return no conflict on error
      expect(result.conflict).toBe(false);
    });

    it('should flag needs_reverification in database when conflict detected', async () => {
      // Last scanned 20 months ago - stale for food
      const twentyMonthsAgo = new Date();
      twentyMonthsAgo.setMonth(twentyMonthsAgo.getMonth() - 20);

      const mockExisting = {
        last_scanned_at: twentyMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Old Product',
          brand: 'Old Brand',
          product_type: 'food'
        }
      };

      let updateWasCalled = false;
      let updatePayload = null;

      const mockEq = jest.fn(() => Promise.resolve({ error: null }));
      const mockUpdate = jest.fn((payload) => {
        updateWasCalled = true;
        updatePayload = payload;
        return { eq: mockEq };
      });

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        })),
        update: mockUpdate
      }));

      await checkBarcodeConflict('012345678901', 'Completely Different Product', 'Different Brand');

      expect(updateWasCalled).toBe(true);
      expect(updatePayload).toEqual({ needs_reverification: true });
      expect(mockEq).toHaveBeenCalledWith('barcode', '012345678901');
    });

    it('should handle null brand in existing product gracefully', async () => {
      const twentyMonthsAgo = new Date();
      twentyMonthsAgo.setMonth(twentyMonthsAgo.getMonth() - 20);

      const mockExisting = {
        last_scanned_at: twentyMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Generic Apple',
          brand: null,  // No brand
          product_type: 'food'
        }
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        }))
      }));

      // Different name but brand can't be compared
      const result = await checkBarcodeConflict('012345678901', 'Apple', null);

      // Should detect based on name similarity (Apple is substring of Generic Apple)
      expect(result.conflict).toBe(false);
    });

    it('should handle null detected product name gracefully', async () => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

      const mockExisting = {
        last_scanned_at: twoMonthsAgo.toISOString(),
        needs_reverification: false,
        product: {
          product_name: 'Some Product',
          brand: 'Some Brand',
          product_type: 'food'
        }
      };

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: mockExisting, error: null }))
          }))
        }))
      }));

      // Null detected name should not cause crash
      const result = await checkBarcodeConflict('012345678901', null, null);

      expect(result.conflict).toBe(false);
    });
  });
});
