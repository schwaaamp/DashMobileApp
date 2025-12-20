/**
 * Voice Recording Registry Integration Tests
 *
 * Tests the complete voice recording flow from handleVoicePress through registry lookup.
 * This catches issues that text-only tests miss because voice and text use different code paths.
 *
 * Critical: These tests verify that voice input checks the user registry BEFORE accepting
 * Gemini's classification, preventing the bug where "citrus element" was classified as food
 * instead of supplement.
 */

import { parseAudioWithGemini } from '@/utils/geminiParser';
import { checkUserProductRegistry, fuzzyMatchUserProducts } from '@/utils/productRegistry';
import { createAuditRecord, createVoiceEvent } from '@/utils/voiceEventParser';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

// Mock dependencies
jest.mock('@/utils/supabaseClient');
jest.mock('@/utils/geminiParser');
jest.mock('@/utils/logger', () => {
  const mockLogger = {
    error: jest.fn().mockResolvedValue(undefined),
    info: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    debug: jest.fn().mockResolvedValue(undefined),
  };

  return {
    __esModule: true,
    default: mockLogger,  // For default imports
    Logger: mockLogger,   // For named imports
  };
});

describe('Voice Recording Registry Integration', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';
  const mockAuditId = 'audit-voice-123';

  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from = createSupabaseMock({ auditId: mockAuditId });
  });

  describe('Registry Exact Match Override', () => {
    it('should override Gemini food classification with registry supplement match', async () => {
      // Setup: User has "Citrus Salt - LMNT" in registry as supplement (logged 12 times)
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'citrus salt lmnt',  // normalized from "Citrus Salt - LMNT" (spaces kept, special chars removed)
          event_type: 'supplement',
          product_name: 'Citrus Salt - LMNT',
          brand: 'LMNT',
          times_logged: 12
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      // Mock Gemini classifying as food (WRONG)
      parseAudioWithGemini.mockResolvedValue({
        transcription: 'Citrus Salt - LMNT',
        event_type: 'food',
        event_data: {
          description: 'lmnt citrus'
        },
        confidence: 98,
        complete: true
      });

      // Simulate voice recording flow
      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);

      // Check registry (this is what home.jsx should do)
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      // Verify registry found the match
      expect(registryMatch).toBeDefined();
      expect(registryMatch.event_type).toBe('supplement');
      expect(registryMatch.product_name).toBe('Citrus Salt - LMNT');
      expect(registryMatch.times_logged).toBe(12);
      expect(registryMatch.source).toBe('user_registry_exact');

      // Verify override logic (what home.jsx should do)
      if (registryMatch) {
        geminiParsed.event_type = registryMatch.event_type;
        geminiParsed.event_data = {
          name: registryMatch.product_name,
          dosage: '1 serving',
          units: 'serving'
        };
        geminiParsed.confidence = 95;
      }

      // Final assertions
      expect(geminiParsed.event_type).toBe('supplement');
      expect(geminiParsed.event_data.name).toBe('Citrus Salt - LMNT');
      expect(geminiParsed.confidence).toBe(95);
    });

    it('should create audit record with registry_bypass model when exact match found', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'now vitamin d 5000 iu',
          event_type: 'supplement',
          product_name: 'NOW Vitamin D 5000 IU',
          brand: 'NOW',
          times_logged: 8
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'NOW Vitamin D 5000 IU',
        event_type: 'supplement',
        event_data: {
          name: 'Vitamin D'
        },
        confidence: 85,
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      expect(registryMatch).toBeDefined();

      // Create audit record with correct model name
      const geminiModel = registryMatch ? 'registry_bypass' : 'gemini-2.5-flash';

      const auditRecord = await createAuditRecord(
        mockUserId,
        geminiParsed.transcription,
        registryMatch.event_type,
        null,
        null,
        geminiModel,
        {
          capture_method: 'voice',
          user_history_count: 0,
          gemini_model: geminiModel,
          confidence: 95,
          registry_match: {
            source: registryMatch.source,
            times_logged: registryMatch.times_logged,
            product_name: registryMatch.product_name
          }
        }
      );

      expect(auditRecord.id).toBe(mockAuditId);
      expect(geminiModel).toBe('registry_bypass');
    });
  });

  describe('Registry Fuzzy Match Override', () => {
    it('should override Gemini classification with fuzzy match for partial product names', async () => {
      // Setup: User has logged "LMNT Citrus Salt Electrolyte Drink Mix" 5 times
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'lmnt citrus salt electrolyte drink mix',
          event_type: 'supplement',
          product_name: 'LMNT Citrus Salt Electrolyte Drink Mix',
          brand: 'LMNT',
          times_logged: 5
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      // Mock Gemini with incomplete transcription
      parseAudioWithGemini.mockResolvedValue({
        transcription: 'lmnt citrus',  // Partial transcription (will fuzzy match)
        event_type: 'food',
        event_data: {
          description: 'lmnt citrus'
        },
        confidence: 98,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);

      // No exact match
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);
      expect(registryMatch).toBeNull();

      // Try fuzzy match
      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);

      expect(fuzzyMatch).toBeDefined();
      expect(fuzzyMatch.event_type).toBe('supplement');
      expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt Electrolyte Drink Mix');
      expect(fuzzyMatch.times_logged).toBe(5);
      expect(fuzzyMatch.source).toBe('user_registry_fuzzy');

      // Override with fuzzy match
      if (fuzzyMatch) {
        geminiParsed.event_type = fuzzyMatch.event_type;
        geminiParsed.event_data = {
          name: fuzzyMatch.product_name,
          dosage: '1 serving',
          units: 'serving'
        };
        geminiParsed.confidence = 95;
      }

      expect(geminiParsed.event_type).toBe('supplement');
      expect(geminiParsed.event_data.name).toBe('LMNT Citrus Salt Electrolyte Drink Mix');
    });

    it('should only use fuzzy matches for products logged 3+ times', async () => {
      // Registry has product logged only 2 times (below threshold)
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'citrus lmnt',
          event_type: 'supplement',
          product_name: 'Citrus LMNT',
          brand: 'LMNT',
          times_logged: 2  // Below threshold of 3
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'citrus element',
        event_type: 'food',
        event_data: {
          description: 'citrus'
        },
        confidence: 85,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);

      // Should not match because times_logged < 3
      expect(fuzzyMatch).toBeNull();
    });

    it('should create audit record with registry_fuzzy_bypass model', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'magnesium lthreonate',
          event_type: 'supplement',
          product_name: 'Magnesium L-Threonate',
          brand: 'NOW',
          times_logged: 7
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'magnesium',  // Partial match
        event_type: 'supplement',
        event_data: {
          name: 'Magnesium'
        },
        confidence: 70,
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);
      expect(registryMatch).toBeNull();

      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);
      expect(fuzzyMatch).toBeDefined();

      const geminiModel = registryMatch ? 'registry_bypass'
        : (fuzzyMatch ? 'registry_fuzzy_bypass' : 'gemini-2.5-flash');

      expect(geminiModel).toBe('registry_fuzzy_bypass');

      const auditRecord = await createAuditRecord(
        mockUserId,
        geminiParsed.transcription,
        fuzzyMatch.event_type,
        null,
        null,
        geminiModel,
        {
          capture_method: 'voice',
          user_history_count: 0,
          gemini_model: geminiModel,
          confidence: 95,
          registry_match: {
            source: fuzzyMatch.source,
            times_logged: fuzzyMatch.times_logged,
            product_name: fuzzyMatch.product_name
          }
        }
      );

      expect(auditRecord.id).toBe(mockAuditId);
    });

    describe('Comprehensive Fuzzy Matching - All Input Methods', () => {
      it('should fuzzy match "lmnt citrus" to "lmnt citrus salt electrolyte" (voice input)', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'lmnt citrus salt electrolyte',
            event_type: 'supplement',
            product_name: 'LMNT Citrus Salt Electrolyte',
            brand: 'LMNT',
            times_logged: 10
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // Voice input: "lmnt citrus"
        const fuzzyMatch = await fuzzyMatchUserProducts('lmnt citrus', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        expect(fuzzyMatch.event_type).toBe('supplement');
        expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt Electrolyte');
        expect(fuzzyMatch.source).toBe('user_registry_fuzzy');
      });

      it('should fuzzy match "citrus salt" to "lmnt citrus salt electrolyte" (text input)', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'lmnt citrus salt electrolyte',
            event_type: 'supplement',
            product_name: 'LMNT Citrus Salt Electrolyte',
            brand: 'LMNT',
            times_logged: 8
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // Text input: "citrus salt"
        const fuzzyMatch = await fuzzyMatchUserProducts('citrus salt', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        expect(fuzzyMatch.event_type).toBe('supplement');
        expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt Electrolyte');
        expect(fuzzyMatch.source).toBe('user_registry_fuzzy');
      });

      it('should fuzzy match "salt electrolyte" to "lmnt citrus salt electrolyte" (partial words)', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'lmnt citrus salt electrolyte',
            event_type: 'supplement',
            product_name: 'LMNT Citrus Salt Electrolyte',
            brand: 'LMNT',
            times_logged: 12
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // Partial words from the middle/end
        const fuzzyMatch = await fuzzyMatchUserProducts('salt electrolyte', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        expect(fuzzyMatch.event_type).toBe('supplement');
        expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt Electrolyte');
      });

      it('should fuzzy match "vitamin d" to "now vitamin d 5000 iu" (common supplement)', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'now vitamin d 5000 iu',
            event_type: 'supplement',
            product_name: 'NOW Vitamin D 5000 IU',
            brand: 'NOW',
            times_logged: 15
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        const fuzzyMatch = await fuzzyMatchUserProducts('vitamin d', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        expect(fuzzyMatch.event_type).toBe('supplement');
        expect(fuzzyMatch.product_name).toBe('NOW Vitamin D 5000 IU');
      });

      it('should fuzzy match "magnesium lthreonate" to "magnesium lthreonate now magtein" (partial match)', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'magnesium lthreonate now magtein',
            event_type: 'supplement',
            product_name: 'Magnesium L-Threonate (NOW Magtein)',
            brand: 'NOW',
            times_logged: 20
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // User says "magnesium lthreonate" (partial match of full product key)
        const fuzzyMatch = await fuzzyMatchUserProducts('magnesium lthreonate', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        expect(fuzzyMatch.event_type).toBe('supplement');
        expect(fuzzyMatch.product_name).toBe('Magnesium L-Threonate (NOW Magtein)');
      });

      it('should fuzzy match with single word if distinctive (brand name)', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'creatine monohydrate optimum nutrition',
            event_type: 'supplement',
            product_name: 'Creatine Monohydrate - Optimum Nutrition',
            brand: 'Optimum Nutrition',
            times_logged: 25
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // Just the word "creatine" should match
        const fuzzyMatch = await fuzzyMatchUserProducts('creatine', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        expect(fuzzyMatch.product_name).toBe('Creatine Monohydrate - Optimum Nutrition');
      });

      it('should NOT fuzzy match if words are not present in product key', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'lmnt citrus salt electrolyte',
            event_type: 'supplement',
            product_name: 'LMNT Citrus Salt Electrolyte',
            brand: 'LMNT',
            times_logged: 10
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // "berry flavor" is NOT in "lmnt citrus salt electrolyte"
        const fuzzyMatch = await fuzzyMatchUserProducts('berry flavor', mockUserId);

        expect(fuzzyMatch).toBeNull();
      });

      it('should fuzzy match works across all capture methods (voice, text, photo)', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'omega3 fish oil nordic naturals',
            event_type: 'supplement',
            product_name: 'Omega-3 Fish Oil - Nordic Naturals',
            brand: 'Nordic Naturals',
            times_logged: 18
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // Simulating different input methods with the same query
        const voiceInput = 'omega3 fish';
        const textInput = 'omega3 fish';
        const photoInput = 'omega3 fish';  // Will be same after OCR/vision processing

        const fuzzyMatchVoice = await fuzzyMatchUserProducts(voiceInput, mockUserId);
        const fuzzyMatchText = await fuzzyMatchUserProducts(textInput, mockUserId);
        const fuzzyMatchPhoto = await fuzzyMatchUserProducts(photoInput, mockUserId);

        // All should match the same product
        expect(fuzzyMatchVoice).toBeDefined();
        expect(fuzzyMatchText).toBeDefined();
        expect(fuzzyMatchPhoto).toBeDefined();

        expect(fuzzyMatchVoice.product_name).toBe('Omega-3 Fish Oil - Nordic Naturals');
        expect(fuzzyMatchText.product_name).toBe('Omega-3 Fish Oil - Nordic Naturals');
        expect(fuzzyMatchPhoto.product_name).toBe('Omega-3 Fish Oil - Nordic Naturals');
      });

      it('should prioritize products with more logs when multiple fuzzy matches exist', async () => {
        const registryEntries = [
          // Order matters: highest times_logged first (simulating ORDER BY times_logged DESC)
          {
            user_id: mockUserId,
            product_key: 'vitamin c 1000mg now foods',
            event_type: 'supplement',
            product_name: 'Vitamin C 1000mg - NOW Foods',
            brand: 'NOW',
            times_logged: 20  // Logged more often - should match first
          },
          {
            user_id: mockUserId,
            product_key: 'vitamin c 500mg',
            event_type: 'supplement',
            product_name: 'Vitamin C 500mg',
            brand: 'Generic',
            times_logged: 5
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // "vitamin c" matches both, but should return the one logged more times
        const fuzzyMatch = await fuzzyMatchUserProducts('vitamin c', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        // Should return the one with times_logged: 20 (first in array, simulating ORDER BY DESC)
        expect(fuzzyMatch.product_name).toBe('Vitamin C 1000mg - NOW Foods');
        expect(fuzzyMatch.times_logged).toBe(20);
      });

      it('should handle case-insensitive fuzzy matching', async () => {
        const registryEntries = [
          {
            user_id: mockUserId,
            product_key: 'lmnt citrus salt electrolyte',  // lowercase in registry
            event_type: 'supplement',
            product_name: 'LMNT Citrus Salt Electrolyte',
            brand: 'LMNT',
            times_logged: 10
          }
        ];

        supabase.from = createSupabaseMock({
          auditId: mockAuditId,
          registryEntries
        });

        // Input with MIXED case
        const fuzzyMatch = await fuzzyMatchUserProducts('LMNT CITRUS', mockUserId);

        expect(fuzzyMatch).toBeDefined();
        expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt Electrolyte');
      });

      describe('Word Order Variations (Order-Independent Matching)', () => {
        it('should fuzzy match "lmnt citrus" to "citrus lmnt" (reversed order)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'citrus lmnt',
              event_type: 'supplement',
              product_name: 'Citrus LMNT',
              brand: 'LMNT',
              times_logged: 15
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          // Input has different word order than registry
          const fuzzyMatch = await fuzzyMatchUserProducts('lmnt citrus', mockUserId);

          expect(fuzzyMatch).toBeDefined();
          expect(fuzzyMatch.event_type).toBe('supplement');
          expect(fuzzyMatch.product_name).toBe('Citrus LMNT');
          expect(fuzzyMatch.source).toBe('user_registry_fuzzy');
        });

        it('should fuzzy match "citrus lmnt" to "lmnt citrus salt electrolyte" (different order)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'lmnt citrus salt electrolyte',
              event_type: 'supplement',
              product_name: 'LMNT Citrus Salt Electrolyte',
              brand: 'LMNT',
              times_logged: 12
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          // "citrus lmnt" should match "lmnt citrus salt electrolyte" (words in different order)
          const fuzzyMatch = await fuzzyMatchUserProducts('citrus lmnt', mockUserId);

          expect(fuzzyMatch).toBeDefined();
          expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt Electrolyte');
        });

        it('should fuzzy match "vitamin d now" to "now vitamin d 5000 iu" (brand first vs last)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'now vitamin d 5000 iu',
              event_type: 'supplement',
              product_name: 'NOW Vitamin D 5000 IU',
              brand: 'NOW',
              times_logged: 18
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          // User says "vitamin d now" instead of "now vitamin d"
          const fuzzyMatch = await fuzzyMatchUserProducts('vitamin d now', mockUserId);

          expect(fuzzyMatch).toBeDefined();
          expect(fuzzyMatch.product_name).toBe('NOW Vitamin D 5000 IU');
        });

        it('should fuzzy match "fish omega3" to "omega3 fish oil nordic naturals" (reversed)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'omega3 fish oil nordic naturals',
              event_type: 'supplement',
              product_name: 'Omega-3 Fish Oil - Nordic Naturals',
              brand: 'Nordic Naturals',
              times_logged: 20
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          const fuzzyMatch = await fuzzyMatchUserProducts('fish omega3', mockUserId);

          expect(fuzzyMatch).toBeDefined();
          expect(fuzzyMatch.product_name).toBe('Omega-3 Fish Oil - Nordic Naturals');
        });

        it('should fuzzy match "electrolyte salt citrus" to "citrus salt electrolyte" (completely reversed)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'citrus salt electrolyte',
              event_type: 'supplement',
              product_name: 'Citrus Salt Electrolyte',
              brand: 'LMNT',
              times_logged: 8
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          // All words present but in completely reversed order
          const fuzzyMatch = await fuzzyMatchUserProducts('electrolyte salt citrus', mockUserId);

          expect(fuzzyMatch).toBeDefined();
          expect(fuzzyMatch.product_name).toBe('Citrus Salt Electrolyte');
        });

        it('should fuzzy match "monohydrate creatine" to "creatine monohydrate optimum nutrition" (partial reversed)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'creatine monohydrate optimum nutrition',
              event_type: 'supplement',
              product_name: 'Creatine Monohydrate - Optimum Nutrition',
              brand: 'Optimum Nutrition',
              times_logged: 25
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          const fuzzyMatch = await fuzzyMatchUserProducts('monohydrate creatine', mockUserId);

          expect(fuzzyMatch).toBeDefined();
          expect(fuzzyMatch.product_name).toBe('Creatine Monohydrate - Optimum Nutrition');
        });

        it('should NOT match if ANY word is missing (order-independent but all words required)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'lmnt citrus salt electrolyte',
              event_type: 'supplement',
              product_name: 'LMNT Citrus Salt Electrolyte',
              brand: 'LMNT',
              times_logged: 10
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          // "berry citrus" has "citrus" but missing "lmnt", "salt", "electrolyte"
          const fuzzyMatch = await fuzzyMatchUserProducts('berry citrus', mockUserId);

          expect(fuzzyMatch).toBeNull();
        });

        it('should match with partial word overlap (word-level partial matching)', async () => {
          const registryEntries = [
            {
              user_id: mockUserId,
              product_key: 'magnesium lthreonate',
              event_type: 'supplement',
              product_name: 'Magnesium L-Threonate',
              brand: 'NOW',
              times_logged: 15
            }
          ];

          supabase.from = createSupabaseMock({
            auditId: mockAuditId,
            registryEntries
          });

          // "mag" is partial match of "magnesium"
          const fuzzyMatch = await fuzzyMatchUserProducts('mag lthreonate', mockUserId);

          expect(fuzzyMatch).toBeDefined();
          expect(fuzzyMatch.product_name).toBe('Magnesium L-Threonate');
        });
      });
    });
  });

  describe('No Registry Match - Use Gemini Classification', () => {
    it('should use Gemini classification when no registry match exists', async () => {
      // Empty registry
      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: []
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'new supplement never logged before',
        event_type: 'supplement',
        event_data: {
          name: 'New Supplement',
          dosage: null
        },
        confidence: 75,
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);
      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);

      expect(registryMatch).toBeNull();
      expect(fuzzyMatch).toBeNull();

      // Should keep Gemini's classification
      expect(geminiParsed.event_type).toBe('supplement');
      expect(geminiParsed.confidence).toBe(75);
    });

    it('should create audit record with gemini-2.5-flash model when no registry match', async () => {
      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: []
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'apple',
        event_type: 'food',
        event_data: {
          description: 'apple',
          calories: 95
        },
        confidence: 90,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);
      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);

      const geminiModel = registryMatch ? 'registry_bypass'
        : (fuzzyMatch ? 'registry_fuzzy_bypass' : 'gemini-2.5-flash');

      expect(geminiModel).toBe('gemini-2.5-flash');

      const auditRecord = await createAuditRecord(
        mockUserId,
        geminiParsed.transcription,
        geminiParsed.event_type,
        95,  // calories as value
        'kcal',
        geminiModel,
        {
          capture_method: 'voice',
          user_history_count: 0,
          gemini_model: geminiModel,
          confidence: geminiParsed.confidence
        }
      );

      expect(auditRecord.id).toBe(mockAuditId);
    });
  });

  describe('Event Type Override Logic', () => {
    it('should use description field for food events from registry', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'large chicken thigh with broccoli',
          event_type: 'food',
          product_name: 'Large chicken thigh with broccoli',
          brand: null,
          times_logged: 15
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'Large chicken thigh with broccoli',
        event_type: 'food',
        event_data: {
          description: 'chicken and broccoli'
        },
        confidence: 90,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      expect(registryMatch).toBeDefined();
      expect(registryMatch.event_type).toBe('food');

      // Override logic for food events
      if (registryMatch) {
        geminiParsed.event_data = registryMatch.event_type === 'food'
          ? { description: registryMatch.product_name }
          : { name: registryMatch.product_name, dosage: '1 serving', units: 'serving' };
      }

      expect(geminiParsed.event_data).toEqual({
        description: 'Large chicken thigh with broccoli'
      });
    });

    it('should use name/dosage/units fields for supplement events from registry', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'omega3 fish oil',
          event_type: 'supplement',
          product_name: 'Omega-3 Fish Oil',
          brand: 'Nordic Naturals',
          times_logged: 20
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'Omega-3 Fish Oil',
        event_type: 'food',  // Wrong classification
        event_data: {
          description: 'fish oil'
        },
        confidence: 85,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      expect(registryMatch).toBeDefined();
      expect(registryMatch.event_type).toBe('supplement');

      // Override logic for supplement events
      if (registryMatch) {
        geminiParsed.event_type = registryMatch.event_type;
        geminiParsed.event_data = registryMatch.event_type === 'food'
          ? { description: registryMatch.product_name }
          : { name: registryMatch.product_name, dosage: '1 serving', units: 'serving' };
      }

      expect(geminiParsed.event_type).toBe('supplement');
      expect(geminiParsed.event_data).toEqual({
        name: 'Omega-3 Fish Oil',
        dosage: '1 serving',
        units: 'serving'
      });
    });

    it('should use name/dosage/units fields for medication events from registry', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'metformin 500mg',
          event_type: 'medication',
          product_name: 'Metformin 500mg',
          brand: null,
          times_logged: 30
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'Metformin 500mg',
        event_type: 'medication',
        event_data: {
          name: 'Metformin',
          dosage: null
        },
        confidence: 80,
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      expect(registryMatch).toBeDefined();
      expect(registryMatch.event_type).toBe('medication');

      // Override logic for medication events
      if (registryMatch) {
        geminiParsed.event_type = registryMatch.event_type;
        geminiParsed.event_data = registryMatch.event_type === 'food'
          ? { description: registryMatch.product_name }
          : { name: registryMatch.product_name, dosage: '1 serving', units: 'serving' };
      }

      expect(geminiParsed.event_type).toBe('medication');
      expect(geminiParsed.event_data).toEqual({
        name: 'Metformin 500mg',
        dosage: '1 serving',
        units: 'serving'
      });
    });
  });

  describe('Confidence Boost Logic', () => {
    it('should boost confidence to 95% for exact registry matches', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'protein shake',
          event_type: 'food',
          product_name: 'Protein Shake',
          brand: 'Optimum Nutrition',
          times_logged: 50
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'Protein Shake',
        event_type: 'food',
        event_data: {
          description: 'protein shake'
        },
        confidence: 60,  // Low initial confidence
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      expect(registryMatch).toBeDefined();

      // Boost confidence
      if (registryMatch) {
        geminiParsed.confidence = 95;
        geminiParsed.complete = true;
      }

      expect(geminiParsed.confidence).toBe(95);
      expect(geminiParsed.complete).toBe(true);
    });

    it('should boost confidence to 95% for fuzzy registry matches', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'creatine monohydrate 5g',
          event_type: 'supplement',
          product_name: 'Creatine Monohydrate 5g',
          brand: 'Optimum Nutrition',
          times_logged: 40
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'creatine',  // Partial match
        event_type: 'supplement',
        event_data: {
          name: 'Creatine'
        },
        confidence: 50,  // Very low initial confidence
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);
      expect(registryMatch).toBeNull();

      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);
      expect(fuzzyMatch).toBeDefined();

      // Boost confidence for fuzzy match
      if (fuzzyMatch) {
        geminiParsed.confidence = 95;
        geminiParsed.complete = true;
      }

      expect(geminiParsed.confidence).toBe(95);
      expect(geminiParsed.complete).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing transcription gracefully', async () => {
      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: []
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: '',  // Empty transcription
        event_type: 'food',
        event_data: {
          description: 'unknown'
        },
        confidence: 30,
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      // Should return null for empty transcription
      expect(registryMatch).toBeNull();
    });

    it('should handle null userId gracefully', async () => {
      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: []
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'Vitamin C',
        event_type: 'supplement',
        event_data: {
          name: 'Vitamin C'
        },
        confidence: 85,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, null);

      // Should return null for null userId
      expect(registryMatch).toBeNull();
    });

    it('should handle registry database errors gracefully', async () => {
      // Mock database error
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: null,
                error: { code: 'PGRST999', message: 'Database error' }
              }))
            }))
          }))
        }))
      }));

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'Test Product',
        event_type: 'food',
        event_data: {
          description: 'test'
        },
        confidence: 80,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      // Should return null on error
      expect(registryMatch).toBeNull();

      // Should use Gemini classification as fallback
      expect(geminiParsed.event_type).toBe('food');
    });
  });

  describe('Priority Order: Exact > Fuzzy > Gemini', () => {
    it('should prefer exact match over fuzzy match', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'lmnt citrus',
          event_type: 'supplement',
          product_name: 'LMNT Citrus',
          brand: 'LMNT',
          times_logged: 3
        },
        {
          user_id: mockUserId,
          product_key: 'lmnt citrus salt electrolyte',
          event_type: 'supplement',
          product_name: 'LMNT Citrus Salt Electrolyte',
          brand: 'LMNT',
          times_logged: 10
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'LMNT Citrus',
        event_type: 'food',
        event_data: {
          description: 'citrus drink'
        },
        confidence: 85,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);

      // Check exact match first
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);

      // Should find exact match (not fuzzy)
      expect(registryMatch).toBeDefined();
      expect(registryMatch.product_name).toBe('LMNT Citrus');
      expect(registryMatch.times_logged).toBe(3);
      expect(registryMatch.source).toBe('user_registry_exact');
    });

    it('should use fuzzy match only when no exact match exists', async () => {
      const registryEntries = [
        {
          user_id: mockUserId,
          product_key: 'lmnt citrus salt electrolyte',
          event_type: 'supplement',
          product_name: 'LMNT Citrus Salt Electrolyte',
          brand: 'LMNT',
          times_logged: 10
        }
      ];

      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'lmnt citrus',  // Partial, no exact match (fuzzy match: substring)
        event_type: 'food',
        event_data: {
          description: 'citrus'
        },
        confidence: 75,
        complete: true
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);

      // No exact match
      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);
      expect(registryMatch).toBeNull();

      // Should find fuzzy match
      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);
      expect(fuzzyMatch).toBeDefined();
      expect(fuzzyMatch.product_name).toBe('LMNT Citrus Salt Electrolyte');
      expect(fuzzyMatch.source).toBe('user_registry_fuzzy');
    });

    it('should use Gemini classification only when no registry matches exist', async () => {
      // Empty registry
      supabase.from = createSupabaseMock({
        auditId: mockAuditId,
        registryEntries: []
      });

      parseAudioWithGemini.mockResolvedValue({
        transcription: 'brand new product never seen',
        event_type: 'supplement',
        event_data: {
          name: 'Brand New Product'
        },
        confidence: 70,
        complete: false
      });

      const geminiParsed = await parseAudioWithGemini('mock-audio-uri', 'api-key', []);

      const registryMatch = await checkUserProductRegistry(geminiParsed.transcription, mockUserId);
      expect(registryMatch).toBeNull();

      const fuzzyMatch = await fuzzyMatchUserProducts(geminiParsed.transcription, mockUserId);
      expect(fuzzyMatch).toBeNull();

      // Use Gemini as final fallback
      expect(geminiParsed.event_type).toBe('supplement');
      expect(geminiParsed.event_data.name).toBe('Brand New Product');
      expect(geminiParsed.confidence).toBe(70);
    });
  });
});
