/**
 * Integration Tests: Photo → Event Flow
 * Tests complete photo capture flow with product catalog integration
 *
 * Expected behavior:
 * - Upload photo to Supabase Storage
 * - Analyze with Gemini Vision (barcode + OCR)
 * - Search product catalog for match
 * - Generate follow-up question for quantity
 * - Handle user response and create event
 */

import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue('base64encodedimage'),
  EncodingType: {
    Base64: 'base64'
  }
}));

// Mock productCatalog for tests that need catalog matches
jest.mock('@/utils/productCatalog', () => ({
  detectBarcode: jest.fn().mockResolvedValue({ success: false, barcode: null }),
  lookupByBarcode: jest.fn().mockResolvedValue(null),
  searchProductCatalog: jest.fn().mockResolvedValue([]),
  incrementProductUsage: jest.fn().mockResolvedValue(null),
  addProductToCatalog: jest.fn().mockResolvedValue({ success: true, product: {} }),
  normalizeProductKey: jest.fn(text => text?.toLowerCase() || ''),
  findCatalogMatch: jest.fn().mockResolvedValue(null)
}));

const { searchProductCatalog, detectBarcode } = require('@/utils/productCatalog');

describe('Photo → Event Integration Tests', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-photo-123';
  const photoPath = '/Users/schwaaamp/DashMobileApp/mobile/__tests__/now_magtein.png';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Supabase client methods
    supabase.from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
          }))
        }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: { id: mockAuditId },
            error: null
          }))
        }))
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null }))
      }))
    }));

    // Mock Supabase Storage
    supabase.storage = {
      from: jest.fn(() => ({
        upload: jest.fn(() => Promise.resolve({
          data: { path: `user-photos/${mockUserId}/test.png` },
          error: null
        })),
        getPublicUrl: jest.fn(() => ({
          data: { publicUrl: 'https://example.com/photo.png' }
        }))
      }))
    };
  });

  it('should import analyzeSupplementPhoto from photoAnalysis module', () => {
    // Test that the module exports the required function
    const { analyzeSupplementPhoto } = require('@/utils/photoAnalysis');

    expect(analyzeSupplementPhoto).toBeDefined();
    expect(typeof analyzeSupplementPhoto).toBe('function');
  });

  it('should analyze NOW Magtein supplement photo and identify product', async () => {
    // Mock Gemini Vision API response
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                items: [{
                  name: 'Magtein Magnesium L-Threonate',
                  brand: 'NOW',
                  form: 'capsules',
                  event_type: 'supplement'
                }],
                confidence: 90
              })
            }]
          }
        }]
      })
    });

    const { analyzeSupplementPhoto } = require('@/utils/photoAnalysis');

    const result = await analyzeSupplementPhoto(
      photoPath,
      mockUserId,
      'test-api-key'
    );

    // Expected structure when implemented
    expect(result.success).toBe(true);
    expect(result.items).toBeDefined();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].event_type).toBe('supplement');
    expect(result.items[0].name).toContain('Magtein');
  });

  it('should recognize missing quantity and return incomplete status (with catalog match)', async () => {
    // Mock catalog match so we get the quantity flow, not nutrition label flow
    // Using real DB record format for NOW Magtein
    searchProductCatalog.mockResolvedValueOnce([{
      id: 'ec5c637a-a575-490e-9c1a-59d3a4b1ed0e',
      product_key: 'now magtein magnesium l threonate',
      product_name: 'Magtein Magnesium L-Threonate',
      brand: 'NOW',
      product_type: 'supplement',
      serving_quantity: 3,
      serving_unit: 'capsules',
      micros: {
        Magtein: { unit: 'g', amount: 2 },
        'Magnesium (elemental)': { unit: 'mg', amount: 144 }
      },
      active_ingredients: [{ name: 'Magnesium L-Threonate', atc_code: null, strength: null }],
      times_logged: 10
    }]);

    // Mock Gemini Vision API response for photo analysis
    global.fetch = jest.fn()
      // First call: Gemini Vision for product detection
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [{
                    name: 'Magtein Magnesium L-Threonate',
                    brand: 'NOW',
                    form: 'capsules',
                    event_type: 'supplement'
                  }],
                  confidence: 90
                })
              }]
            }
          }]
        })
      })
      // Second call: Barcode detection (returns no barcode)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  success: false,
                  barcode: null
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should be incomplete due to missing quantity
    expect(result.complete).toBe(false);
    expect(result.missingFields).toContain('quantity');
    expect(result.parsed).toBeDefined();
  });

  it('should return requiresNutritionLabel when no catalog match found', async () => {
    // Mock Gemini Vision API response for photo analysis
    global.fetch = jest.fn()
      // First call: Gemini Vision for product detection
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [{
                    name: 'Some New Supplement',
                    brand: 'Unknown Brand',
                    form: 'capsules',
                    event_type: 'supplement'
                  }],
                  confidence: 90
                })
              }]
            }
          }]
        })
      })
      // Second call: Barcode detection (returns no barcode)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  success: false,
                  barcode: null
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should require nutrition label for new product
    expect(result.success).toBe(true);
    expect(result.requiresNutritionLabel).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.parsed).toBeDefined();
  });

  it('should generate follow-up question for missing quantity (with catalog match)', async () => {
    // Mock catalog match so we get the quantity flow
    // Using real DB record format for NOW Magtein
    searchProductCatalog.mockResolvedValueOnce([{
      id: 'ec5c637a-a575-490e-9c1a-59d3a4b1ed0e',
      product_key: 'now magtein magnesium l threonate',
      product_name: 'Magtein Magnesium L-Threonate',
      brand: 'NOW',
      product_type: 'supplement',
      serving_quantity: 3,
      serving_unit: 'capsules',
      micros: {
        Magtein: { unit: 'g', amount: 2 },
        'Magnesium (elemental)': { unit: 'mg', amount: 144 }
      },
      active_ingredients: [{ name: 'Magnesium L-Threonate', atc_code: null, strength: null }],
      times_logged: 10
    }]);

    // Mock Gemini Vision API responses
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [{
                    name: 'Magtein Magnesium L-Threonate',
                    brand: 'NOW',
                    form: 'capsules',
                    event_type: 'supplement'
                  }],
                  confidence: 90
                })
              }]
            }
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  success: false,
                  barcode: null
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should have a follow-up question
    expect(result.followUpQuestion).toBeDefined();
    expect(result.followUpQuestion).toMatch(/how many/i);
    expect(result.followUpQuestion).toContain('capsules');
    expect(result.followUpQuestion).toContain('Magtein');
  });

  it('should upload photo to Supabase Storage and store URL in audit record', async () => {
    // Mock Gemini Vision API responses
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [{
                    name: 'Magtein Magnesium L-Threonate',
                    brand: 'NOW',
                    form: 'capsules',
                    event_type: 'supplement'
                  }],
                  confidence: 90
                })
              }]
            }
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  success: false,
                  barcode: null
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Verify photo upload attempted and audit record created
    expect(result.auditId).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.photoUrl).toBeDefined();
    expect(result.parsed).toBeDefined();
  });

  it('should store voice_records_audit with photo metadata', async () => {
    // Mock Gemini Vision API responses
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [{
                    name: 'Magtein Magnesium L-Threonate',
                    brand: 'NOW',
                    form: 'capsules',
                    event_type: 'supplement'
                  }],
                  confidence: 90
                })
              }]
            }
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  success: false,
                  barcode: null
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should have created audit record
    expect(result.success).toBe(true);
    expect(result.auditId).toBeDefined();
    expect(supabase.from).toHaveBeenCalledWith('voice_records_audit');
  });

  it('should use Gemini 2.5 Flash for photo analysis', async () => {
    const { analyzeSupplementPhoto } = require('@/utils/photoAnalysis');

    // Mock fetch to capture the API call
    const mockFetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                items: [{
                  name: 'Magtein Magnesium L-Threonate',
                  brand: 'NOW',
                  form: 'capsules',
                  event_type: 'supplement'
                }],
                confidence: 90
              })
            }]
          }
        }]
      })
    }));
    global.fetch = mockFetch;

    await analyzeSupplementPhoto(
      photoPath,
      mockUserId,
      'test-api-key'
    );

    // Verify Gemini API was called
    expect(mockFetch).toHaveBeenCalled();
    const apiCall = mockFetch.mock.calls[0];
    expect(apiCall[0]).toContain('generativelanguage.googleapis.com');
    expect(apiCall[0]).toContain('gemini');
  });

  it('should handle processPhotoInput end-to-end flow (with catalog match)', async () => {
    // Mock catalog match so we get followUpQuestion
    // Using real DB record format for NOW Magtein
    searchProductCatalog.mockResolvedValueOnce([{
      id: 'ec5c637a-a575-490e-9c1a-59d3a4b1ed0e',
      product_key: 'now magtein magnesium l threonate',
      product_name: 'Magtein Magnesium L-Threonate',
      brand: 'NOW',
      product_type: 'supplement',
      serving_quantity: 3,
      serving_unit: 'capsules',
      micros: {
        Magtein: { unit: 'g', amount: 2 },
        'Magnesium (elemental)': { unit: 'mg', amount: 144 }
      },
      active_ingredients: [{ name: 'Magnesium L-Threonate', atc_code: null, strength: null }],
      times_logged: 10
    }]);

    // Mock Gemini Vision API responses
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [{
                    name: 'Magtein Magnesium L-Threonate',
                    brand: 'NOW',
                    form: 'capsules',
                    event_type: 'supplement'
                  }],
                  confidence: 90
                })
              }]
            }
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  success: false,
                  barcode: null
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Expected result structure when catalog match exists
    expect(result).toMatchObject({
      success: true,
      complete: false,
      followUpQuestion: expect.any(String),
      auditId: expect.any(String),
      parsed: expect.objectContaining({
        event_type: 'supplement',
        complete: false
      })
    });
  });

  it('should handle processPhotoInput with nutrition label flow (no catalog match)', async () => {
    // Mock Gemini Vision API responses
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [{
                    name: 'Some New Supplement',
                    brand: 'New Brand',
                    form: 'capsules',
                    event_type: 'supplement'
                  }],
                  confidence: 90
                })
              }]
            }
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  success: false,
                  barcode: null
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Expected result structure when no catalog match (nutrition label required)
    expect(result).toMatchObject({
      success: true,
      complete: false,
      requiresNutritionLabel: true,
      auditId: expect.any(String),
      parsed: expect.objectContaining({
        event_type: 'supplement',
        complete: false
      })
    });
    expect(result.followUpQuestion).toBeUndefined();
  });

  it('should convert image to base64 for Gemini API', async () => {
    const { imageToBase64 } = require('@/utils/photoAnalysis');

    const base64 = await imageToBase64(photoPath);

    expect(base64).toBeDefined();
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
    expect(base64).toBe('base64encodedimage'); // Should match our mock
  });

  it('should handle follow-up response and complete event creation', async () => {
    // Mock the audit record fetch with detected items
    supabase.from = jest.fn((table) => {
      if (table === 'voice_records_audit') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: mockAuditId,
                  nlp_metadata: {
                    detected_items: [{
                      name: 'Magtein Magnesium L-Threonate',
                      brand: 'NOW',
                      form: 'capsules',
                      event_type: 'supplement'
                    }],
                    catalog_match: null // No catalog match
                  }
                },
                error: null
              }))
            }))
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ error: null }))
          }))
        };
      }
      if (table === 'voice_events') {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: 'event-123',
                  event_type: 'supplement',
                  event_data: {
                    name: 'Magtein Magnesium L-Threonate',
                    brand: 'NOW',
                    dosage: '2',
                    units: 'capsules',
                    quantity_taken: '2 capsules',
                    product_catalog_id: null
                  },
                  capture_method: 'photo'
                },
                error: null
              }))
            }))
          }))
        };
      }
      if (table === 'product_catalog') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: null, // No catalog product found
                error: null
              }))
            }))
          }))
        };
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: null, error: null }))
        })),
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: null, error: null }))
          }))
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null }))
        }))
      };
    });

    const { handleFollowUpResponse } = require('@/utils/photoEventParser');

    // Simulate user responding to "How many capsules?"
    const result = await handleFollowUpResponse(
      mockAuditId,
      '2', // quantityResponse
      mockUserId
    );

    // Should create voice_events entry
    expect(result.success).toBe(true);
    expect(result.event).toBeDefined();
    expect(result.event.event_type).toBe('supplement');
    expect(result.event.capture_method).toBe('photo');
  });

  it('should return isMultiItem=true when multiple supplements detected', async () => {
    // Mock catalog match for all items - using real DB record format
    searchProductCatalog
      .mockResolvedValueOnce([{
        id: 'catalog-1',
        product_key: 'now vitamin d3',
        product_name: 'Vitamin D3',
        brand: 'NOW',
        product_type: 'supplement',
        times_logged: 5
      }])
      .mockResolvedValueOnce([{
        id: 'catalog-2',
        product_key: 'nordic naturals omega 3',
        product_name: 'Omega-3',
        brand: 'Nordic Naturals',
        product_type: 'supplement',
        times_logged: 3
      }])
      .mockResolvedValueOnce([{
        id: 'catalog-3',
        product_key: 'now magnesium',
        product_name: 'Magnesium',
        brand: 'NOW',
        product_type: 'supplement',
        times_logged: 8
      }]);

    // Mock Gemini Vision API response with 3 items
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [
                    { name: 'Vitamin D3', brand: 'NOW', form: 'softgels', event_type: 'supplement' },
                    { name: 'Omega-3', brand: 'Nordic Naturals', form: 'softgels', event_type: 'supplement' },
                    { name: 'Magnesium', brand: 'NOW', form: 'capsules', event_type: 'supplement' }
                  ],
                  confidence: 90
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should be multi-item mode
    expect(result.success).toBe(true);
    expect(result.isMultiItem).toBe(true);
    expect(result.detectedItems).toBeDefined();
    expect(result.detectedItems.length).toBe(3);

    // Each item should have catalog match info
    result.detectedItems.forEach(item => {
      expect(item.name).toBeDefined();
      expect(item.brand).toBeDefined();
      expect(item.selected).toBe(true); // Default selected
    });

    // Should have match counts
    expect(result.matchedCount).toBe(3);
    expect(result.needsLabelCount).toBe(0);
  });

  it('should handle mixed multi-item (some with catalog, some without)', async () => {
    // Mock: first two items have catalog match, third does not
    // Using real DB record format
    searchProductCatalog
      .mockResolvedValueOnce([{
        id: 'catalog-1',
        product_key: 'now vitamin d3',
        product_name: 'Vitamin D3',
        brand: 'NOW',
        product_type: 'supplement',
        times_logged: 5
      }])
      .mockResolvedValueOnce([{
        id: 'catalog-2',
        product_key: 'nordic naturals omega 3',
        product_name: 'Omega-3',
        brand: 'Nordic Naturals',
        product_type: 'supplement',
        times_logged: 3
      }])
      .mockResolvedValueOnce([]); // No match for third item

    // Mock Gemini Vision API response with 3 items
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  items: [
                    { name: 'Vitamin D3', brand: 'NOW', form: 'softgels', event_type: 'supplement' },
                    { name: 'Omega-3', brand: 'Nordic Naturals', form: 'softgels', event_type: 'supplement' },
                    { name: 'New Supplement', brand: 'Unknown', form: 'capsules', event_type: 'supplement' }
                  ],
                  confidence: 90
                })
              }]
            }
          }]
        })
      });

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should be multi-item mode
    expect(result.success).toBe(true);
    expect(result.isMultiItem).toBe(true);
    expect(result.detectedItems.length).toBe(3);

    // Two with catalog, one without
    expect(result.matchedCount).toBe(2);
    expect(result.needsLabelCount).toBe(1);

    // Check individual items
    const itemsWithCatalog = result.detectedItems.filter(i => i.catalogMatch);
    const itemsNeedingLabel = result.detectedItems.filter(i => i.requiresNutritionLabel);

    expect(itemsWithCatalog.length).toBe(2);
    expect(itemsNeedingLabel.length).toBe(1);
    expect(itemsNeedingLabel[0].name).toBe('New Supplement');
  });
});
