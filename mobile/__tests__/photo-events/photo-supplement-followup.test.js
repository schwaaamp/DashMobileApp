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

  it('should recognize missing quantity and return incomplete status', async () => {
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

  it('should generate follow-up question for missing quantity', async () => {
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

  it('should handle processPhotoInput end-to-end flow', async () => {
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

    // Expected result structure
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
});
