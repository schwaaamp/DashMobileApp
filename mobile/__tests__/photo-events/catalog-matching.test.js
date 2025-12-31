/**
 * Catalog Matching Tests
 *
 * Tests for finding existing products in the catalog and
 * preventing duplicate entries when products already exist.
 *
 * Updated for new barcode architecture (product_barcodes table)
 */

// Mock expo-file-system/legacy
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' }
}));

// Mock Supabase - we'll override from() in each test
jest.mock('../../src/utils/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(() => Promise.resolve({}))
  }
}));

// Import after mocks
import { findCatalogMatch, normalizeProductKey } from '../../src/utils/productCatalog';
import { supabase } from '../../src/utils/supabaseClient';

describe('Catalog Matching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('normalizeProductKey', () => {
    it('should lowercase and remove special characters', () => {
      expect(normalizeProductKey('NOW Foods')).toBe('now foods');
      expect(normalizeProductKey('Magtein (Magnesium L-Threonate)')).toBe('magtein magnesium l threonate');
      expect(normalizeProductKey("Nature's Valley")).toBe('natures valley');
    });

    it('should normalize brand variations', () => {
      // "NOW" and "NOW Foods" should produce similar keys
      const nowKey = normalizeProductKey('NOW');
      const nowFoodsKey = normalizeProductKey('NOW Foods');
      expect(nowFoodsKey).toContain(nowKey);
    });

    it('should handle empty or null input', () => {
      expect(normalizeProductKey('')).toBe('');
      expect(normalizeProductKey(null)).toBe('');
      expect(normalizeProductKey(undefined)).toBe('');
    });
  });

  describe('findCatalogMatch - Barcode Matching', () => {
    it('should return exact match when barcode is found', async () => {
      const mockProduct = {
        id: 'uuid-123',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement',
        serving_quantity: 3,
        serving_unit: 'capsule',
        micros: { magnesium: { amount: 144, unit: 'mg' } }
      };

      const mockBarcodeRecord = {
        barcode: '733739021427',
        total_quantity: 90,
        total_unit: 'capsule',
        container_type: 'bottle',
        needs_reverification: false,
        last_scanned_at: '2025-01-01T00:00:00Z',
        product: mockProduct
      };

      // Mock product_barcodes returning match
      supabase.from.mockImplementation((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockBarcodeRecord, error: null }))
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

      const result = await findCatalogMatch({
        barcode: '733739021427',
        productName: 'Magtein',
        brand: 'NOW'
      });

      expect(result).not.toBeNull();
      expect(result.matchMethod).toBe('barcode');
      expect(result.id).toBe('uuid-123');
      expect(result.product_name).toBe('Magtein Magnesium L-Threonate');
    });

    it('should fall back to text search when barcode not found', async () => {
      const mockProduct = {
        id: 'uuid-456',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement'
      };

      // Mock barcode lookup returning null, then text search returning match
      supabase.from.mockImplementation((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              }))
            }))
          };
        } else if (table === 'product_catalog') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              })),
              or: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({ data: [mockProduct], error: null }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      const result = await findCatalogMatch({
        barcode: null,
        productName: 'Magtein',
        brand: 'NOW'
      });

      expect(result).not.toBeNull();
      expect(result.matchMethod).toBe('text_search');
    });
  });

  describe('findCatalogMatch - Text Search', () => {
    it('should match "NOW Magtein" to "NOW Foods Magtein Magnesium L-Threonate"', async () => {
      const mockProduct = {
        id: 'uuid-789',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement',
        search_rank: 0.8
      };

      // No barcode match, text search returns match
      supabase.from.mockImplementation((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              }))
            }))
          };
        } else if (table === 'product_catalog') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              })),
              or: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({ data: [mockProduct], error: null }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      const result = await findCatalogMatch({
        barcode: null,
        productName: 'Magtein',
        brand: 'NOW'
      });

      expect(result).not.toBeNull();
      expect(result.brand).toBe('NOW Foods');
    });

    it('should return null for unknown product (no catalog match)', async () => {
      // No barcode match, text search returns empty
      supabase.from.mockImplementation((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              }))
            }))
          };
        } else if (table === 'product_catalog') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              })),
              or: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      const result = await findCatalogMatch({
        barcode: null,
        productName: 'SuperObscureSupplement',
        brand: 'UnknownBrand'
      });

      expect(result).toBeNull();
    });
  });

  describe('Duplicate Prevention', () => {
    it('should find existing entry on second photo of same product', async () => {
      const existingProduct = {
        id: 'uuid-existing',
        product_name: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods',
        product_type: 'supplement',
        times_logged: 5
      };

      // Simulate second photo - should find existing via text search
      supabase.from.mockImplementation((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              }))
            }))
          };
        } else if (table === 'product_catalog') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              })),
              or: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({ data: [existingProduct], error: null }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      const result = await findCatalogMatch({
        barcode: null,
        productName: 'Magtein Magnesium L-Threonate',
        brand: 'NOW Foods'
      });

      expect(result).not.toBeNull();
      expect(result.id).toBe('uuid-existing');
      expect(result.times_logged).toBe(5);
    });

    it('should match with brand normalization (NOW vs NOW Foods)', async () => {
      const existingProduct = {
        id: 'uuid-now-foods',
        product_name: 'Vitamin D3',
        brand: 'NOW Foods',  // Full brand name in catalog
        product_type: 'supplement'
      };

      supabase.from.mockImplementation((table) => {
        if (table === 'product_barcodes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              }))
            }))
          };
        } else if (table === 'product_catalog') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
              })),
              or: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({ data: [existingProduct], error: null }))
                }))
              }))
            }))
          };
        }
        return {};
      });

      // User photo detected "NOW" (short form)
      const result = await findCatalogMatch({
        barcode: null,
        productName: 'Vitamin D3',
        brand: 'NOW'  // Short brand name from Gemini
      });

      expect(result).not.toBeNull();
      expect(result.brand).toBe('NOW Foods');
    });
  });
});
