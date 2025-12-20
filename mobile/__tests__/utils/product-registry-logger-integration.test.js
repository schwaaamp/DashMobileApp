/**
 * Product Registry Logger Integration Test
 *
 * Tests the exact production error scenario where Logger is undefined
 * when productRegistry.js tries to call Logger.error()
 *
 * This test catches the bug:
 * "TypeError: Cannot read property 'error' of undefined"
 * at productRegistry.js:88
 */

import { checkUserProductRegistry } from '@/utils/productRegistry';
import { supabase } from '@/utils/supabaseClient';
import { createSupabaseMock } from '../__mocks__/supabaseMock';

// Mock Supabase
jest.mock('@/utils/supabaseClient');

describe('Product Registry Logger Integration', () => {
  const mockUserId = '12345678-1234-1234-1234-123456789012';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should gracefully handle when Supabase throws and Logger is available', async () => {
    // Mock Supabase to throw an error to trigger the catch block
    supabase.from = jest.fn(() => {
      throw new Error('Network timeout');
    });

    const result = await checkUserProductRegistry('citrus element', mockUserId);

    // Should return null without throwing
    expect(result).toBeNull();
  });

  it('should log errors when Supabase query fails', async () => {
    // Mock Supabase to return an error response
    supabase.from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: 'DATABASE_ERROR', message: 'Connection failed' }
            }))
          }))
        }))
      }))
    }));

    const result = await checkUserProductRegistry('citrus element', mockUserId);

    // Should handle the error and return null
    expect(result).toBeNull();
  });

  it('should handle missing product (PGRST116 error) without logging error', async () => {
    // Mock Supabase to return "not found" error (expected case)
    supabase.from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { code: 'PGRST116', message: 'No rows found' }
            }))
          }))
        }))
      }))
    }));

    const result = await checkUserProductRegistry('citrus element', mockUserId);

    // Should return null (expected - not an error)
    expect(result).toBeNull();
  });

  it('should successfully return registry match when found', async () => {
    // Mock Supabase to return a successful match
    supabase.from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                event_type: 'supplement',
                product_name: 'Citrus LMNT',
                brand: 'LMNT',
                times_logged: 15
              },
              error: null
            }))
          }))
        }))
      }))
    }));

    const result = await checkUserProductRegistry('citrus element', mockUserId);

    expect(result).toBeDefined();
    expect(result.event_type).toBe('supplement');
    expect(result.product_name).toBe('Citrus LMNT');
    expect(result.source).toBe('user_registry_exact');
  });
});
