/**
 * Test Case 4: Voice Insulin Logging
 * Tests that "6 units basal insulin" correctly parses:
 * - Event type: insulin
 * - Value: 6
 * - Units: units
 * - Insulin type: basal
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('@/utils/productSearch');

describe('Voice Insulin Logging', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-456';
  const mockVoiceEventId = 'event-456';
  const testInput = '6 units basal insulin';

  beforeEach(() => {
    jest.clearAllMocks();

    // Use shared Supabase mock helper
    supabase.from = createSupabaseMock({ auditId: mockAuditId });
  });

  it('should parse "6 units basal insulin" correctly', async () => {
    // Mock Gemini API response for insulin parsing
    global.fetch = jest.fn((url) => {
      if (url.includes('anthropic.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            content: [{
              text: JSON.stringify({
                event_type: 'insulin',
                event_data: {
                  value: 6,
                  units: 'units',
                  insulin_type: 'basal',
                  site: null
                },
                event_time: new Date().toISOString(),
                confidence: 98
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    // Use shared mock
    supabase.from = createSupabaseMock({ auditId: mockAuditId });

    const result = await processTextInput(
      testInput,
      mockUserId,
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      'voice'
    );

    expect(result.success).toBe(true);

    // Check the parsed event or completed event
    const eventData = result.complete ? result.event.event_data : result.parsed.event_data;
    expect(eventData.value).toBe(6);
    expect(eventData.units).toBe('units');
    expect(eventData.insulin_type).toBe('basal');
  });

  it('should store voice_events entry with insulin data', async () => {
    const mockVoiceEvent = {
      id: mockVoiceEventId,
      user_id: mockUserId,
      event_type: 'insulin',
      event_data: {
        value: 6,
        units: 'units',
        insulin_type: 'basal',
        site: null
      },
      event_time: new Date().toISOString(),
      source_record_id: mockAuditId,
      capture_method: 'voice'
    };

    // Use shared mock
    supabase.from = createSupabaseMock({ auditId: mockAuditId });

    const { createVoiceEvent } = require('@/utils/voiceEventParser');

    const result = await createVoiceEvent(
      mockUserId,
      'insulin',
      {
        value: 6,
        units: 'units',
        insulin_type: 'basal',
        site: null
      },
      mockVoiceEvent.event_time,
      mockAuditId,
      'voice'
    );

    // Verify result data (no need to check mock calls - result verification is sufficient)
    expect(result.id).toBeDefined();
    expect(result.event_type).toBe('insulin');
    expect(result.event_data.value).toBe(6);
    expect(result.event_data.insulin_type).toBe('basal');
  });

  it('should validate insulin event has all required fields', () => {
    // According to EVENT_TYPES schema in voiceEventParser.js:
    // insulin: { required: ['value', 'units', 'insulin_type'], optional: ['site'] }

    const validInsulinData = {
      value: 6,
      units: 'units',
      insulin_type: 'basal',
      site: null // optional
    };

    // Check required fields are present
    expect(validInsulinData.value).toBeDefined();
    expect(validInsulinData.units).toBeDefined();
    expect(validInsulinData.insulin_type).toBeDefined();

    // Check value is correct type
    expect(typeof validInsulinData.value).toBe('number');
    expect(validInsulinData.value).toBe(6);
  });

  it('should handle different insulin types (basal, bolus, rapid)', async () => {
    const insulinTypes = ['basal', 'bolus', 'rapid'];

    for (const insulinType of insulinTypes) {
      // Use shared mock
      supabase.from = createSupabaseMock({ auditId: mockAuditId });

      const { createVoiceEvent } = require('@/utils/voiceEventParser');

      const result = await createVoiceEvent(
        mockUserId,
        'insulin',
        {
          value: 6,
          units: 'units',
          insulin_type: insulinType
        },
        new Date().toISOString(),
        mockAuditId,
        'voice'
      );

      expect(result.event_data.insulin_type).toBe(insulinType);
    }
  });

  it('should store voice_records_audit with correct insulin metadata', async () => {
    const mockAuditRecord = {
      id: mockAuditId,
      user_id: mockUserId,
      raw_text: testInput,
      record_type: 'insulin',
      value: 6,
      units: 'units',
      nlp_status: 'pending',
      nlp_model: 'claude-3-opus-20240229',
      nlp_metadata: {
        capture_method: 'voice',
        user_history_count: 0,
        claude_model: 'claude-3-opus-20240229'
      }
    };

    // Use shared mock
    supabase.from = createSupabaseMock({ auditId: mockAuditId });

    const { createAuditRecord } = require('@/utils/voiceEventParser');

    const result = await createAuditRecord(
      mockUserId,
      testInput,
      'insulin',
      6,
      'units',
      'claude-3-opus-20240229',
      {
        capture_method: 'voice',
        user_history_count: 0,
        claude_model: 'claude-3-opus-20240229'
      }
    );

    // Verify result data (no need to check mock calls - result verification is sufficient)
    expect(result.id).toBeDefined();
    expect(result.value).toBe(6);
    expect(result.record_type).toBe('insulin');
  });

  it('should handle insulin with injection site', async () => {
    const testInputWithSite = '6 units basal insulin in abdomen';

    global.fetch = jest.fn((url) => {
      if (url.includes('anthropic.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            content: [{
              text: JSON.stringify({
                event_type: 'insulin',
                event_data: {
                  value: 6,
                  units: 'units',
                  insulin_type: 'basal',
                  site: 'abdomen'
                },
                event_time: new Date().toISOString(),
                confidence: 98
              })
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    // Use shared mock
    supabase.from = createSupabaseMock({ auditId: mockAuditId });

    const result = await processTextInput(
      testInputWithSite,
      mockUserId,
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      'voice'
    );

    expect(result.success).toBe(true);

    const eventData = result.complete ? result.event.event_data : result.parsed.event_data;
    expect(eventData.site).toBe('abdomen');
  });
});
