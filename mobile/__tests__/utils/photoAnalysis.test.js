/**
 * Tests for photoAnalysis.js - Gemini Vision API integration
 */

import {
  imageToBase64,
  uploadPhotoToSupabase,
  analyzeSupplementPhoto,
  generateFollowUpQuestion
} from '../../src/utils/photoAnalysis';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../src/utils/supabaseClient';

// Mock FileSystem (legacy path)
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: {
    Base64: 'base64'
  }
}));

// Mock Supabase
jest.mock('../../src/utils/supabaseClient', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(),
        getPublicUrl: jest.fn()
      }))
    }
  }
}));

// Mock fetch
global.fetch = jest.fn();

describe('photoAnalysis', () => {
  beforeEach(() => {
    // Complete reset of all mocks to prevent test pollution
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Reset fetch implementation to clean state
    global.fetch = jest.fn();

    // Reset FileSystem mock
    FileSystem.readAsStringAsync.mockReset();
  });

  afterEach(() => {
    // Clean up any residual mock state
    jest.restoreAllMocks();
  });

  describe('imageToBase64', () => {
    test('should convert image URI to base64 string', async () => {
      const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAUA';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const result = await imageToBase64('file://test.jpg');

      expect(result).toBe(mockBase64);
      expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(
        'file://test.jpg',
        { encoding: 'base64' }
      );
    });

    test('should throw error if file read fails', async () => {
      FileSystem.readAsStringAsync.mockRejectedValueOnce(new Error('File not found'));

      await expect(imageToBase64('file://invalid.jpg')).rejects.toThrow('Failed to read image file');
    });
  });

  describe('uploadPhotoToSupabase', () => {
    test('should upload photo and return public URL', async () => {
      const mockBase64 = 'base64data';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockUpload = jest.fn().mockResolvedValueOnce({ data: { path: 'test' }, error: null });
      const mockGetPublicUrl = jest.fn().mockReturnValueOnce({
        data: { publicUrl: 'https://storage.supabase.co/user-photos/user123/12345_supplement.jpg' }
      });

      const mockStorageChain = {
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl
      };

      supabase.storage.from.mockImplementation(() => mockStorageChain);

      global.fetch.mockResolvedValueOnce({
        blob: async () => new Blob()
      });

      const result = await uploadPhotoToSupabase('file://test.jpg', 'user123');

      expect(result.error).toBeNull();
      expect(result.url).toContain('https://storage.supabase.co/user-photos/user123/');
      expect(supabase.storage.from).toHaveBeenCalledWith('user-photos');
    });

    test('should handle upload error', async () => {
      const mockBase64 = 'base64data';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockUpload = jest.fn().mockResolvedValueOnce({
        data: null,
        error: { message: 'Storage quota exceeded' }
      });

      supabase.storage.from.mockReturnValueOnce({
        upload: mockUpload,
        getPublicUrl: jest.fn()
      });

      global.fetch.mockResolvedValueOnce({
        blob: async () => new Blob()
      });

      const result = await uploadPhotoToSupabase('file://test.jpg', 'user123');

      expect(result.url).toBeNull();
      expect(result.error).toBe('Storage quota exceeded');
    });
  });

  describe('analyzeSupplementPhoto', () => {
    test('should detect single supplement from photo', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockGeminiResponse = {
        items: [
          {
            name: 'Vitamin D3',
            brand: 'NOW',
            form: 'softgels',
            event_type: 'supplement'
          }
        ],
        confidence: 90
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockGeminiResponse) }]
            }
          }]
        })
      });

      const result = await analyzeSupplementPhoto('file://test.jpg', 'user123', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Vitamin D3');
      expect(result.items[0].brand).toBe('NOW');
      expect(result.confidence).toBe(90);
    });

    test('should detect multiple supplements from single photo', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockGeminiResponse = {
        items: [
          { name: 'Vitamin D3', brand: 'NOW', form: 'softgels', event_type: 'supplement' },
          { name: 'Magnesium L-Threonate', brand: 'NOW', form: 'capsules', event_type: 'supplement' },
          { name: 'Omega-3', brand: 'Nordic Naturals', form: 'softgels', event_type: 'supplement' }
        ],
        confidence: 85
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockGeminiResponse) }]
            }
          }]
        })
      });

      const result = await analyzeSupplementPhoto('file://test.jpg', 'user123', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].name).toBe('Vitamin D3');
      expect(result.items[1].name).toBe('Magnesium L-Threonate');
      expect(result.items[2].name).toBe('Omega-3');
    });

    test('should default event_type to supplement if not specified', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockGeminiResponse = {
        items: [
          { name: 'Vitamin C', brand: 'Nature Made', form: 'tablets' }
          // No event_type specified
        ],
        confidence: 88
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockGeminiResponse) }]
            }
          }]
        })
      });

      const result = await analyzeSupplementPhoto('file://test.jpg', 'user123', 'test-api-key');

      expect(result.success).toBe(true);
      expect(result.items[0].event_type).toBe('supplement');
    });

    test('should handle Gemini API error', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded'
      });

      const result = await analyzeSupplementPhoto('file://test.jpg', 'user123', 'test-api-key');

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
      expect(result.confidence).toBe(0);
      expect(result.error).toContain('429');
    });

    test('should validate response has items array', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockGeminiResponse = {
        // Missing items array
        confidence: 85
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockGeminiResponse) }]
            }
          }]
        })
      });

      const result = await analyzeSupplementPhoto('file://test.jpg', 'user123', 'test-api-key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing items array');
    });

    test('should validate each item has name and brand', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockGeminiResponse = {
        items: [
          { name: 'Vitamin D3' }  // Missing brand
        ],
        confidence: 85
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockGeminiResponse) }]
            }
          }]
        })
      });

      const result = await analyzeSupplementPhoto('file://test.jpg', 'user123', 'test-api-key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing name or brand');
    });

    test('should use correct Gemini model (gemini-2.0-flash-exp)', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockGeminiResponse = {
        items: [{ name: 'Test', brand: 'Test Brand', event_type: 'supplement' }],
        confidence: 85
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockGeminiResponse) }]
            }
          }]
        })
      });

      await analyzeSupplementPhoto('file://test.jpg', 'user123', 'test-api-key');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-2.0-flash-exp'),
        expect.any(Object)
      );
    });

    test('should detect PNG vs JPEG mime type', async () => {
      const mockBase64 = 'base64image';
      FileSystem.readAsStringAsync.mockResolvedValueOnce(mockBase64);

      const mockGeminiResponse = {
        items: [{ name: 'Test', brand: 'Test', event_type: 'supplement' }],
        confidence: 85
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(mockGeminiResponse) }]
            }
          }]
        })
      });

      await analyzeSupplementPhoto('file://test.png', 'user123', 'test-api-key');

      const fetchCall = global.fetch.mock.calls[0][1];
      const requestBody = JSON.parse(fetchCall.body);

      expect(requestBody.contents[0].parts[1].inline_data.mime_type).toBe('image/png');
    });
  });

  describe('generateFollowUpQuestion', () => {
    test('should generate question with serving size info', () => {
      const item = {
        name: 'Magnesium L-Threonate',
        brand: 'NOW',
        form: 'capsules'
      };

      const servingInfo = {
        servingSize: '2 capsules'
      };

      const question = generateFollowUpQuestion(item, servingInfo);

      expect(question).toBe('How many capsules of Magnesium L-Threonate did you take?');
    });

    test('should generate question without serving size info', () => {
      const item = {
        name: 'Vitamin D3',
        brand: 'NOW',
        form: 'softgels'
      };

      const question = generateFollowUpQuestion(item, null);

      expect(question).toBe('How many softgels of Vitamin D3 did you take, and what\'s the dosage per softgel?');
    });

    test('should handle missing form field', () => {
      const item = {
        name: 'Probiotic',
        brand: 'Garden of Life'
        // No form field
      };

      const question = generateFollowUpQuestion(item, null);

      expect(question).toContain('capsules');  // Default
    });
  });
});
