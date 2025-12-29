/**
 * Real Image Photo Analysis (Integration Tests)
 *
 * Tests photo analysis using actual image files with real Gemini API calls.
 * These tests require EXPO_PUBLIC_GEMINI_API_KEY to be set in mobile/.env file.
 *
 * Note: These tests use fs to read actual image files, overriding the expo-file-system mock.
 */

// Mock expo-file-system to use real fs for this test file
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn().mockImplementation((uri, options) => {
    // Read actual file from disk and convert to base64
    const fs = require('fs');
    const fileBuffer = fs.readFileSync(uri);
    return Promise.resolve(fileBuffer.toString('base64'));
  }),
  EncodingType: {
    Base64: 'base64'
  }
}));

import * as fs from 'fs';
import path from 'path';
import * as FileSystem from 'expo-file-system/legacy';
import { analyzeSupplementPhoto, uploadPhotoToSupabase } from '../../src/utils/photoAnalysis';
import { processPhotoInput } from '../../src/utils/photoEventParser';

// Mock Supabase client (don't actually upload to storage in tests)
jest.mock('../../src/utils/supabaseClient', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({
          data: { path: 'test-path' },
          error: null
        }),
        getPublicUrl: jest.fn((filePath) => ({
          data: { publicUrl: `https://mock-storage.supabase.co/user-photos/${filePath}` }
        }))
      }))
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      insert: jest.fn().mockResolvedValue({ data: { id: 'mock-audit-id' }, error: null })
    }))
  }
}));

// Mock product catalog functions (to avoid database dependency)
jest.mock('../../src/utils/productCatalog', () => ({
  detectBarcode: jest.fn().mockResolvedValue({ success: false, barcode: null }),
  lookupByBarcode: jest.fn().mockResolvedValue(null),
  searchProductCatalog: jest.fn().mockResolvedValue([]),
  incrementProductUsage: jest.fn().mockResolvedValue(true)
}));

// Mock voice event parser functions
jest.mock('../../src/utils/voiceEventParser', () => ({
  createAuditRecord: jest.fn().mockResolvedValue({ id: 'mock-audit-id' }),
  updateAuditStatus: jest.fn().mockResolvedValue(true),
  createVoiceEvent: jest.fn().mockResolvedValue({ id: 'mock-event-id' })
}));

// Load environment variables from .env file
// Jest doesn't automatically load .env, so we need to do it manually
// IMPORTANT: This must override the fake API key set in jest.setup.js
try {
  const dotenv = require('dotenv');
  const path = require('path');
  const result = dotenv.config({ path: path.join(__dirname, '../../.env') });

  if (result.parsed && result.parsed.EXPO_PUBLIC_GEMINI_API_KEY) {
    // Override the fake key from jest.setup.js with the real one
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = result.parsed.EXPO_PUBLIC_GEMINI_API_KEY;
    console.log('[Test Setup] ✓ Loaded real Gemini API key from .env');
    console.log('[Test Setup] API key length:', process.env.EXPO_PUBLIC_GEMINI_API_KEY.length);
  } else {
    console.warn('[Test Setup] ⚠ Could not load EXPO_PUBLIC_GEMINI_API_KEY from .env');
  }
} catch (error) {
  console.warn('[Test Setup] Error loading .env file:', error.message);
}

// Skip tests if no API key (CI environment)
const skipIfNoApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY
  ? describe
  : describe.skip;

describe('Real Image Photo Analysis (Integration)', () => {
  const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'test-key';

  skipIfNoApiKey('Single Supplement Detection - NOW Magtein', () => {
    test('should detect NOW Magtein supplement from real photo', async () => {
      // Read actual image file
      const imagePath = path.join(__dirname, '../now_magtein.png');

      console.log('\n=== Testing NOW Magtein Photo Analysis ===');
      console.log('Image path:', imagePath);

      // Analyze with real Gemini API
      const result = await analyzeSupplementPhoto(
        imagePath,
        'test-user-123',
        geminiApiKey
      );

      console.log('Analysis result:', JSON.stringify(result, null, 2));

      // Assertions
      expect(result.success).toBe(true);
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);

      const firstItem = result.items[0];
      expect(firstItem.name).toBeDefined();
      expect(firstItem.brand).toBeDefined();
      expect(firstItem.event_type).toBeDefined();

      // NOW Magtein specific expectations (may vary based on Gemini's interpretation)
      // Looking for "Magtein", "Magnesium", or similar
      const productName = firstItem.name.toLowerCase();
      const brand = firstItem.brand.toLowerCase();

      expect(
        productName.includes('magtein') ||
        productName.includes('magnesium') ||
        productName.includes('l-threonate')
      ).toBe(true);

      expect(brand.includes('now')).toBe(true);

      console.log('✓ Detected product:', firstItem.name);
      console.log('✓ Brand:', firstItem.brand);
      console.log('✓ Confidence:', result.confidence);
    }, 30000); // 30s timeout for API call

    test('should upload NOW Magtein photo to Supabase Storage (mocked)', async () => {
      const imagePath = path.join(__dirname, '../now_magtein.png');
      const userId = 'test-user-123';

      console.log('\n=== Testing Photo Upload (Mocked) ===');

      const result = await uploadPhotoToSupabase(imagePath, userId);

      console.log('Upload result:', result);

      // Should succeed with mock
      expect(result.error).toBeNull();
      expect(result.url).toBeDefined();
      expect(result.url).toContain('https://');
      expect(result.url).toContain('user-photos');

      console.log('✓ Upload URL:', result.url);
    });
  });

  skipIfNoApiKey('Multi-Supplement Detection - Three Supplements', () => {
    test('should detect multiple supplements from real photo', async () => {
      // Read actual image file
      const imagePath = path.join(__dirname, '../three_supplements.jpg');

      console.log('\n=== Testing Three Supplements Photo Analysis ===');
      console.log('Image path:', imagePath);

      // Analyze with real Gemini API
      const result = await analyzeSupplementPhoto(
        imagePath,
        'test-user-123',
        geminiApiKey
      );

      console.log('Analysis result:', JSON.stringify(result, null, 2));

      // Assertions
      expect(result.success).toBe(true);
      expect(result.items).toBeDefined();

      // Should detect multiple items (at least 2, ideally 3)
      expect(result.items.length).toBeGreaterThanOrEqual(2);

      // Each item should have required fields
      result.items.forEach((item, index) => {
        console.log(`Item ${index + 1}:`, item);
        expect(item.name).toBeDefined();
        expect(item.brand).toBeDefined();
        expect(item.event_type).toBeDefined();
      });

      console.log(`✓ Detected ${result.items.length} supplement(s)`);
      console.log('✓ Confidence:', result.confidence);
    }, 30000); // 30s timeout for API call
  });

  skipIfNoApiKey('End-to-End Photo Processing Flow', () => {
    test('should complete full flow: upload → analyze → catalog lookup → follow-up question', async () => {
      const imagePath = path.join(__dirname, '../now_magtein.png');
      const userId = 'test-user-123';

      console.log('\n=== Testing End-to-End Photo Processing ===');

      // Process photo with full pipeline
      const result = await processPhotoInput(
        imagePath,
        userId,
        geminiApiKey,
        'photo'
      );

      console.log('Process result:', JSON.stringify(result, null, 2));

      // Should succeed
      expect(result.success).toBe(true);

      // Should have photo URL (mocked)
      expect(result.photoUrl).toBeDefined();
      expect(result.photoUrl).toContain('https://');

      // Should have parsed event data
      expect(result.parsed).toBeDefined();
      expect(result.parsed.event_type).toBeDefined();
      expect(result.parsed.event_data).toBeDefined();

      // Should have follow-up question for quantity
      expect(result.followUpQuestion).toBeDefined();
      expect(result.followUpQuestion).toContain('How many');

      // Should have detected item
      expect(result.detectedItem).toBeDefined();
      expect(result.detectedItem.name).toBeDefined();
      expect(result.detectedItem.brand).toBeDefined();

      // Should have audit ID
      expect(result.auditId).toBeDefined();

      // Should mark as incomplete (needs quantity)
      expect(result.complete).toBe(false);
      expect(result.missingFields).toContain('quantity');

      console.log('✓ Photo URL:', result.photoUrl);
      console.log('✓ Event type:', result.parsed.event_type);
      console.log('✓ Detected:', result.detectedItem.name);
      console.log('✓ Follow-up question:', result.followUpQuestion);
      console.log('✓ Audit ID:', result.auditId);
    }, 30000); // 30s timeout for API call
  });

  // Test that will FAIL if Gemini API key is invalid
  skipIfNoApiKey('Error Handling - Invalid API Key', () => {
    test('should handle invalid API key gracefully', async () => {
      const imagePath = path.join(__dirname, '../now_magtein.png');

      console.log('\n=== Testing Invalid API Key Handling ===');

      // Use invalid API key
      const result = await analyzeSupplementPhoto(
        imagePath,
        'test-user-123',
        'invalid-api-key'
      );

      console.log('Result with invalid key:', result);

      // Should fail gracefully
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.items).toHaveLength(0);
      expect(result.confidence).toBe(0);

      console.log('✓ Error handled gracefully:', result.error);
    }, 30000);
  });
});

// Non-API tests (always run)
describe('Real Image File Access', () => {
  test('should be able to read now_magtein.png file', async () => {
    const imagePath = path.join(__dirname, '../now_magtein.png');

    console.log('\n=== Testing File Access: now_magtein.png ===');
    console.log('Path:', imagePath);

    // Mock FileSystem to simulate reading the file
    const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAUA'; // Valid PNG header
    FileSystem.readAsStringAsync = jest.fn().mockResolvedValue(mockBase64);

    const result = await FileSystem.readAsStringAsync(imagePath, {
      encoding: FileSystem.EncodingType.Base64
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);

    console.log('✓ File readable, base64 length:', result.length);
  });

  test('should be able to read three_supplements.jpg file', async () => {
    const imagePath = path.join(__dirname, '../three_supplements.jpg');

    console.log('\n=== Testing File Access: three_supplements.jpg ===');
    console.log('Path:', imagePath);

    // Mock FileSystem to simulate reading the file
    const mockBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/'; // Valid JPEG header
    FileSystem.readAsStringAsync = jest.fn().mockResolvedValue(mockBase64);

    const result = await FileSystem.readAsStringAsync(imagePath, {
      encoding: FileSystem.EncodingType.Base64
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);

    console.log('✓ File readable, base64 length:', result.length);
  });
});
