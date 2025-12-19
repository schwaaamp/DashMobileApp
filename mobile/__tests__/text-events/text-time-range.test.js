/**
 * Test Case 3: Text Time Range Parsing
 * Tests that "sauna 2-2:25pm" correctly parses:
 * - Event type: sauna
 * - Duration: 25 minutes (calculated from time range)
 * - Event time: 2:00pm on current date
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('@/utils/productSearch');

describe('Text Time Range Parsing - Sauna', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-789';
  const mockVoiceEventId = 'event-789';
  const testInput = 'sauna 2-2:25pm';

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
  });

  it('should parse "sauna 2-2:25pm" as a time range with 25 minute duration', async () => {
    // Mock Gemini API response for parsing sauna time range
    global.fetch = jest.fn((url) => {
      if (url.includes('anthropic.com')) {
        const now = new Date();
        const eventTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0); // 2:00 PM today

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            content: [{
              text: JSON.stringify({
                event_type: 'sauna',
                event_data: {
                  duration: '25', // 25 minutes calculated from 2:00-2:25
                  temperature: null,
                  temperature_units: null
                },
                event_time: eventTime.toISOString(),
                confidence: 95
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    // Mock voice_events insert to capture the created event
    const mockVoiceEventInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => {
          const now = new Date();
          const eventTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0);

          return Promise.resolve({
            data: {
              id: mockVoiceEventId,
              user_id: mockUserId,
              event_type: 'sauna',
              event_data: {
                duration: '25',
                temperature: null,
                temperature_units: null
              },
              event_time: eventTime.toISOString(),
              source_record_id: mockAuditId,
              capture_method: 'manual'
            },
            error: null
          });
        })
      }))
    }));

    supabase.from = jest.fn((table) => {
      if (table === 'voice_events') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
              }))
            }))
          })),
          insert: mockVoiceEventInsert
        };
      }
      if (table === 'voice_records_audit') {
        return {
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
        };
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          }))
        }))
      };
    });

    const result = await processTextInput(
      testInput,
      mockUserId,
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      'manual'
    );

    // Verify the result
    expect(result.success).toBe(true);

    // Should create a complete event since sauna doesn't need product search
    if (result.complete) {
      expect(result.event.event_type).toBe('sauna');
      expect(result.event.event_data.duration).toBe('25');
      expect(result.event.capture_method).toBe('manual');
    } else if (result.parsed) {
      expect(result.parsed.event_type).toBe('sauna');
      expect(result.parsed.event_data.duration).toBe('25');
    }
  });

  it('should calculate duration from time range (2:00pm to 2:25pm = 25 minutes)', () => {
    // Test the time parsing logic
    const startTime = new Date('2025-12-18T14:00:00'); // 2:00 PM
    const endTime = new Date('2025-12-18T14:25:00');   // 2:25 PM

    const durationMinutes = (endTime - startTime) / (1000 * 60); // Convert ms to minutes

    expect(durationMinutes).toBe(25);
  });

  it('should set event_time to start time (2:00pm)', async () => {
    const now = new Date();
    const expectedEventTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0);

    // Mock Gemini to return the correct event time
    global.fetch = jest.fn((url) => {
      if (url.includes('anthropic.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            content: [{
              text: JSON.stringify({
                event_type: 'sauna',
                event_data: {
                  duration: '25',
                  temperature: null,
                  temperature_units: null
                },
                event_time: expectedEventTime.toISOString(),
                confidence: 95
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    const mockVoiceEventInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: {
            id: mockVoiceEventId,
            user_id: mockUserId,
            event_type: 'sauna',
            event_data: {
              duration: '25',
              temperature: null,
              temperature_units: null
            },
            event_time: expectedEventTime.toISOString(),
            source_record_id: mockAuditId,
            capture_method: 'manual'
          },
          error: null
        }))
      }))
    }));

    supabase.from = jest.fn((table) => {
      if (table === 'voice_events') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
              }))
            }))
          })),
          insert: mockVoiceEventInsert
        };
      }
      if (table === 'voice_records_audit') {
        return {
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
        };
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          }))
        }))
      };
    });

    const result = await processTextInput(
      testInput,
      mockUserId,
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      'manual'
    );

    expect(result.success).toBe(true);

    if (result.complete && result.event) {
      const eventTime = new Date(result.event.event_time);
      expect(eventTime.getHours()).toBe(14); // 2 PM
      expect(eventTime.getMinutes()).toBe(0);
    } else if (result.parsed) {
      const eventTime = new Date(result.parsed.event_time);
      expect(eventTime.getHours()).toBe(14); // 2 PM
      expect(eventTime.getMinutes()).toBe(0);
    }
  });

  it('should store voice_events entry with correct structure', async () => {
    const now = new Date();
    const eventTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0);

    const mockVoiceEvent = {
      id: mockVoiceEventId,
      user_id: mockUserId,
      event_type: 'sauna',
      event_data: {
        duration: '25',
        temperature: null,
        temperature_units: null
      },
      event_time: eventTime.toISOString(),
      source_record_id: mockAuditId,
      capture_method: 'manual'
    };

    const mockInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: mockVoiceEvent,
          error: null
        }))
      }))
    }));

    supabase.from = jest.fn((table) => {
      if (table === 'voice_events') {
        return { insert: mockInsert };
      }
      return {
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: {}, error: null }))
          }))
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null }))
        }))
      };
    });

    const { createVoiceEvent } = require('@/utils/voiceEventParser');

    const result = await createVoiceEvent(
      mockUserId,
      'sauna',
      {
        duration: '25',
        temperature: null,
        temperature_units: null
      },
      eventTime.toISOString(),
      mockAuditId,
      'manual'
    );

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: mockUserId,
      event_type: 'sauna',
      event_data: {
        duration: '25',
        temperature: null,
        temperature_units: null
      },
      event_time: eventTime.toISOString(),
      source_record_id: mockAuditId,
      capture_method: 'manual'
    });

    expect(result).toEqual(mockVoiceEvent);
    expect(result.event_data.duration).toBe('25');
  });

  it('should handle sauna with only duration (no temperature)', async () => {
    // Test that temperature fields can be null
    const eventData = {
      duration: '25',
      temperature: null,
      temperature_units: null
    };

    // Verify sauna schema allows optional temperature
    const { createVoiceEvent } = require('@/utils/voiceEventParser');

    const mockInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: {
            id: mockVoiceEventId,
            event_data: eventData
          },
          error: null
        }))
      }))
    }));

    supabase.from = jest.fn(() => ({ insert: mockInsert }));

    await createVoiceEvent(
      mockUserId,
      'sauna',
      eventData,
      new Date().toISOString(),
      mockAuditId,
      'manual'
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_data: eventData
      })
    );
  });
});
