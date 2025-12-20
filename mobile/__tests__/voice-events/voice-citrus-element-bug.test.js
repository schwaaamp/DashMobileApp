/**
 * Test for Production Bug: "citrus element" not matching registry
 *
 * REPRODUCTION STEPS:
 * 1. User has "Citrus LMNT" in registry (logged 12 times as supplement)
 * 2. User says "citrus element" via voice
 * 3. EXPECTED: Match registry, classify as supplement, NO product search
 * 4. ACTUAL: No registry match, product search triggered, shows confirmation screen
 *
 * ROOT CAUSE:
 * - Voice input: "citrus element"
 * - Registry lookup checks: normalizeProductKey("citrus element") = "citrus element"
 * - Registry has: "citrus lmnt" (from previous entry "Citrus LMNT")
 * - NO MATCH because "element" !== "lmnt"
 * - Phonetic transformation happens AFTER Gemini call, not before registry check
 *
 * FIX NEEDED:
 * Either:
 * A) Apply phonetic transformation BEFORE registry lookup
 * B) Fuzzy matching should handle "citrus element" → "citrus lmnt" via phonetic similarity
 */

import { processTextInput } from '@/utils/voiceEventParser';
import { checkUserProductRegistry, fuzzyMatchUserProducts } from '@/utils/productRegistry';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('@/utils/productSearch');

describe('Citrus Element Registry Bug', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-citrus-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should match "citrus element" to registry entry "citrus lmnt" via fuzzy match', async () => {
    // User has "Citrus LMNT" in their registry (logged 5 times as supplement)
    const registryEntries = [
      {
        user_id: mockUserId,
        product_key: 'citrus lmnt',  // normalized from "Citrus LMNT"
        event_type: 'supplement',
        product_name: 'Citrus LMNT',
        brand: 'LMNT',
        times_logged: 5
      }
    ];

    supabase.from = createSupabaseMock({
      auditId: mockAuditId,
      registryEntries
    });

    // User says "citrus element" (phonetic for "LMNT")
    const userInput = 'citrus element';

    // Step 1: Exact match check (should fail)
    const exactMatch = await checkUserProductRegistry(userInput, mockUserId);
    expect(exactMatch).toBeNull(); // No exact match

    // Step 2: Fuzzy match should find it via phonetic similarity
    const fuzzyMatch = await fuzzyMatchUserProducts(userInput, mockUserId);

    // THIS IS THE BUG: fuzzyMatch should find "citrus lmnt" via phonetic matching
    // "element" should be recognized as phonetic variant of "lmnt"
    expect(fuzzyMatch).toBeDefined();
    expect(fuzzyMatch.product_name).toBe('Citrus LMNT');
    expect(fuzzyMatch.event_type).toBe('supplement');
    expect(fuzzyMatch.source).toBe('user_registry_fuzzy');
  });

  it('should bypass product search when "citrus element" matches registry via fuzzy match', async () => {
    const registryEntries = [
      {
        user_id: mockUserId,
        product_key: 'citrus lmnt',
        event_type: 'supplement',
        product_name: 'Citrus LMNT',
        brand: 'LMNT',
        times_logged: 10
      }
    ];

    supabase.from = createSupabaseMock({
      auditId: mockAuditId,
      registryEntries
    });

    // Mock Gemini API to return food classification (before reclassification)
    global.fetch = jest.fn((url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    transcription: 'citrus element',
                    event_type: 'food',
                    event_data: { description: 'LMNT citrus' },
                    time_info: null,
                    confidence: 98
                  })
                }]
              }
            }]
          })
        });
      }
      return Promise.reject(new Error('Unexpected fetch URL'));
    });

    // Process the text input (this is what happens in production)
    const result = await processTextInput(
      'citrus element',
      mockUserId,
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      'voice'
    );

    // EXPECTED: Should match registry and bypass product search
    expect(result.success).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.source).toBe('user_registry'); // From registry, not AI
    expect(result.parsed.event_type).toBe('supplement'); // Corrected from food
    expect(result.productOptions).toBeNull(); // No product search needed
  });

  it('should recognize phonetic pattern: element = lmnt', async () => {
    // Test direct phonetic matching
    const registryEntries = [
      {
        user_id: mockUserId,
        product_key: 'lmnt citrus salt',
        event_type: 'supplement',
        product_name: 'LMNT Citrus Salt',
        brand: 'LMNT',
        times_logged: 8
      }
    ];

    supabase.from = createSupabaseMock({
      auditId: mockAuditId,
      registryEntries
    });

    // Different phonetic variations
    const phoneticInputs = [
      'element citrus salt',
      'citrus element',
      'citrus element salt'
    ];

    for (const input of phoneticInputs) {
      const fuzzyMatch = await fuzzyMatchUserProducts(input, mockUserId);

      expect(fuzzyMatch).toBeDefined();
      expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt');
      expect(fuzzyMatch.event_type).toBe('supplement');
    }
  });
});
