/**
 * Test Suite: Historical Bias Confidence Boosting
 *
 * Tests that user history increases Claude's confidence level when input matches
 * frequently logged items, allowing the system to bypass product search.
 *
 * Key Behavior:
 * - When user has history of "NOW Vitamin D 5000 IU" and says "Vitamin D"
 * - Claude should recognize the pattern and return high confidence (>83%)
 * - System should bypass product search and save directly
 */

import { processTextInput, parseTextWithClaude } from '@/utils/voiceEventParser';
import { shouldSearchProducts } from '@/utils/productSearch';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

// Mock dependencies
jest.mock('@/utils/supabaseClient');

describe('User Product Registry - Self-Learning Classification', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-boost-123';

  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from = createSupabaseMock({ auditId: mockAuditId });
  });

  describe('Registry Bypass WITH Exact Match', () => {
    it('should bypass AI entirely when user has "NOW Vitamin D 5000 IU" in registry and says "NOW Vitamin D 5000 IU"', async () => {
      // Mock user product registry: "NOW Vitamin D 5000 IU" logged 10 times
      const mockRegistryEntry = {
        id: 'registry-123',
        user_id: mockUserId,
        product_key: 'now vitamin d 5000 iu',  // Normalized
        event_type: 'supplement',
        product_name: 'NOW Vitamin D 5000 IU',
        brand: 'NOW',
        times_logged: 10,
        first_logged_at: new Date().toISOString(),
        last_logged_at: new Date().toISOString()
      };

      // Use shared mock with registry entry
      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: [mockRegistryEntry]
      });

      // Claude API should NOT be called - registry bypasses it
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          throw new Error('Claude API should not be called when registry has exact match');
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Test: User says "NOW Vitamin D 5000 IU" (exact match)
      const result = await processTextInput(
        'NOW Vitamin D 5000 IU',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      console.log('TEST DEBUG - Result:', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.confidence).toBe(95); // Registry match = 95% confidence
      expect(result.complete).toBe(true); // Should save directly
      expect(result.source).toBe('user_registry'); // Came from registry

      // Should NOT have product options (bypassed everything)
      expect(result.productOptions == null || result.productOptions.length === 0).toBe(true);

      // Verify Claude API was NOT called
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should bypass AI for frequently logged food items in registry', async () => {
      // Mock user product registry: "Large chicken thigh with broccoli" logged 15 times
      const mockRegistryEntry = {
        id: 'registry-food-123',
        user_id: mockUserId,
        product_key: 'large chicken thigh with broccoli',  // Normalized
        event_type: 'food',
        product_name: 'Large chicken thigh with broccoli',
        brand: null,
        times_logged: 15,
        first_logged_at: new Date().toISOString(),
        last_logged_at: new Date().toISOString()
      };

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: [mockRegistryEntry]
      });

      // Claude API should NOT be called - registry bypasses it
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          throw new Error('Claude API should not be called when registry has exact match');
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Test: User says exact match "Large chicken thigh with broccoli"
      const result = await processTextInput(
        'Large chicken thigh with broccoli',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.success).toBe(true);
      expect(result.confidence).toBe(95); // Registry match = 95% confidence
      expect(result.complete).toBe(true); // Should save directly
      expect(result.source).toBe('user_registry'); // Came from registry

      // Verify Claude API was NOT called
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('NO Registry Match - Falls Back to AI', () => {
    it('should call Claude API when user has NO registry entry for Vitamin D', async () => {
      // Mock EMPTY registry (no match)
      supabase.from = createSupabaseMock({ auditId: mockAuditId, registryEntries: [] });

      // Mock Claude API - LOWER confidence without history
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',
                  event_data: {
                    name: 'Vitamin D',
                    dosage: null,
                    units: null
                  },
                  event_time: new Date().toISOString(),
                  confidence: 75 // LOWER CONFIDENCE without history
                })
              }]
            })
          });
        }
        // Mock product search APIs
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              products: [
                {
                  code: '123',
                  product_name: 'NOW Vitamin D 5000 IU',
                  brands: 'NOW',
                  serving_size: '1 softgel'
                },
                {
                  code: '456',
                  product_name: 'Nature Made Vitamin D3',
                  brands: 'Nature Made',
                  serving_size: '1 tablet'
                }
              ]
            })
          });
        }
        if (url.includes('api.nal.usda.gov')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ foods: [] })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Test: User says "Vitamin D" with NO history
      const result = await processTextInput(
        'Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.success).toBe(true);
      expect(result.confidence).toBeLessThanOrEqual(83); // Low confidence
      expect(result.complete).toBe(false); // Needs confirmation
      expect(result.productOptions).toBeDefined(); // Product search triggered
      expect(result.productOptions.length).toBeGreaterThan(0); // Has options
    });

    it('should NOT match unrelated registry items', async () => {
      // Mock registry: User has "Magnesium" but NOT "Vitamin D"
      const mockRegistryEntry = {
        id: 'registry-mag-123',
        user_id: mockUserId,
        product_key: 'now magnesium lthreonate',  // Normalized (different product)
        event_type: 'supplement',
        product_name: 'NOW Magnesium L-Threonate',
        brand: 'NOW',
        times_logged: 10
      };

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: [mockRegistryEntry]  // Has Magnesium, not Vitamin D
      });

      // Mock Claude API - should be called since no registry match for "Vitamin D"
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              content: [{
                text: JSON.stringify({
                  event_type: 'supplement',
                  event_data: {
                    name: 'Vitamin D',
                    dosage: null,
                    units: null
                  },
                  event_time: new Date().toISOString(),
                  confidence: 70 // Lower confidence - no brand specified
                })
              }]
            })
          });
        }
        if (url.includes('openfoodfacts.org')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ products: [] })
          });
        }
        if (url.includes('api.nal.usda.gov')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ foods: [] })
          });
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Test: User says "Vitamin D" but only has Magnesium in registry
      const result = await processTextInput(
        'Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.confidence).toBeLessThanOrEqual(83);
      expect(result.parsed.event_data.name).not.toContain('Magnesium');
      expect(result.productOptions).toBeDefined(); // Should search

      // Verify Claude API WAS called (no registry match)
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Fuzzy Registry Match', () => {
    it('should fuzzy match when user says partial product name that matches registry (logged 3+ times)', async () => {
      // Mock registry: User has "NOW Vitamin D 5000 IU" logged 5 times
      const mockRegistryEntry = {
        id: 'registry-vit-d',
        user_id: mockUserId,
        product_key: 'now vitamin d 5000 iu',  // Full normalized name
        event_type: 'supplement',
        product_name: 'NOW Vitamin D 5000 IU',
        brand: 'NOW',
        times_logged: 5  // >= 3, so eligible for fuzzy match
      };

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: [mockRegistryEntry]
      });

      // Claude API should NOT be called - fuzzy match bypasses it
      global.fetch = jest.fn((url) => {
        if (url.includes('anthropic.com')) {
          throw new Error('Claude API should not be called when fuzzy registry match exists');
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Test: User says "NOW Vitamin D" (partial match - missing "5000 IU")
      // Fuzzy match should find the registry entry since input is substring of product_key
      const result = await processTextInput(
        'NOW Vitamin D',
        mockUserId,
        process.env.EXPO_PUBLIC_CLAUDE_API_KEY || 'test-key',
        'voice'
      );

      // Assertions
      expect(result.success).toBe(true);
      expect(result.confidence).toBe(95); // Fuzzy match = 95% confidence
      expect(result.complete).toBe(true);
      expect(result.source).toBe('user_registry'); // Came from fuzzy registry match

      // Verify Claude API was NOT called
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
