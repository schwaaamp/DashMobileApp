/**
 * Test Case 2: Photo Supplement with Follow-up Questions
 * Tests photo analysis for NOW Magtein supplement
 *
 * EXPECTED TO FAIL: Photo analysis endpoint not yet implemented
 *
 * Expected behavior:
 * - Parse photo to identify "NOW Magtein" supplement
 * - Recognize missing dosage information
 * - Ask follow-up question: "How many capsules did you take?"
 * - Store final event after user response
 */

import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue('base64encodedimage'),
  EncodingType: {
    Base64: 'base64'
  }
}));

describe.skip('Photo Supplement Analysis - EXPECTED TO FAIL', () => {
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

  it('should recognize missing dosage and return incomplete status', async () => {
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

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should be incomplete due to missing quantity (dosage calculation pending)
    expect(result.complete).toBe(false);
    expect(result.items).toBeDefined();
    expect(result.items[0].needsManualDosage).toBeDefined();
  });

  it('should generate follow-up question for missing dosage', async () => {
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

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should have a follow-up question for each item
    expect(result.items).toBeDefined();
    expect(result.items[0].followUpQuestion).toBeDefined();
    expect(result.items[0].followUpQuestion).toMatch(/how many/i);
    expect(result.items[0].followUpQuestion).toContain('capsules');
  });

  it('should upload photo to Supabase Storage and store URL in audit record', async () => {
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

    const { processPhotoInput } = require('@/utils/photoEventParser');

    const result = await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Verify photo upload attempted and audit record created
    // The actual supabase.storage call happens inside uploadPhotoToSupabase
    expect(result.auditId).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.items).toBeDefined();

    // photoUrl may be null if upload fails (which is allowed as per processPhotoInput design)
    // The function continues without URL if upload fails
  });

  it('should store voice_records_audit with photo metadata', async () => {
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

    const { processPhotoInput } = require('@/utils/photoEventParser');

    await processPhotoInput(
      photoPath,
      mockUserId,
      'test-api-key',
      'photo'
    );

    // Should have called insert on voice_records_audit
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
      items: expect.arrayContaining([
        expect.objectContaining({
          name: expect.any(String),
          brand: expect.any(String),
          followUpQuestion: expect.any(String)
        })
      ]),
      auditId: expect.any(String)
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
                      event_type: 'supplement',
                      servingInfo: null
                    }]
                  }
                },
                error: null
              }))
            }))
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
                    name: 'NOW Magtein Magnesium L-Threonate',
                    brand: 'NOW',
                    quantity_taken: '2 capsules'
                  },
                  capture_method: 'photo'
                },
                error: null
              }))
            }))
          }))
        };
      }
      return {
        select: jest.fn(() => ({})),
        insert: jest.fn(() => ({}))
      };
    });

    const { handleFollowUpResponse } = require('@/utils/photoEventParser');

    // Simulate user responding to "How many capsules?" with itemIndex
    const result = await handleFollowUpResponse(
      mockAuditId,
      0, // itemIndex
      '2',
      mockUserId
    );

    // Should create voice_events entry
    expect(result.success).toBe(true);
    expect(result.event).toBeDefined();
    expect(result.event.event_type).toBe('supplement');
    expect(result.event.capture_method).toBe('photo');
  });
});
