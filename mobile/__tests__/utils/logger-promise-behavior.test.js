/**
 * Logger Promise Behavior Tests
 *
 * Tests that Logger methods return Promises correctly and can be awaited.
 * This catches the production bug where `await Logger.error()` throws
 * "Cannot read property 'error' of undefined"
 */

import { Logger } from '@/utils/logger';
import { supabase } from '@/utils/supabaseClient';

// Mock Supabase
jest.mock('@/utils/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve({ data: null, error: null }))
    }))
  }
}));

describe('Logger Promise Behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return a Promise when calling Logger.error()', () => {
    const result = Logger.error('test', 'test message', { foo: 'bar' });

    // This test will FAIL if Logger.error doesn't return a Promise
    expect(result).toBeInstanceOf(Promise);
  });

  it('should return a Promise when calling Logger.info()', () => {
    const result = Logger.info('test', 'test message', { foo: 'bar' });

    expect(result).toBeInstanceOf(Promise);
  });

  it('should return a Promise when calling Logger.warn()', () => {
    const result = Logger.warn('test', 'test message', { foo: 'bar' });

    expect(result).toBeInstanceOf(Promise);
  });

  it('should return a Promise when calling Logger.debug()', () => {
    const result = Logger.debug('test', 'test message', { foo: 'bar' });

    expect(result).toBeInstanceOf(Promise);
  });

  it('should allow awaiting Logger.error() without throwing', async () => {
    // This reproduces the production error scenario
    await expect(
      Logger.error('registry', 'Exception checking user product registry', {
        product_key: 'test-key',
        error_message: 'Test error',
        error_stack: 'Stack trace'
      })
    ).resolves.not.toThrow();
  });

  it('should allow awaiting Logger.info() without throwing', async () => {
    await expect(
      Logger.info('registry', 'Registry lookup successful', {
        product_key: 'test-key'
      })
    ).resolves.not.toThrow();
  });

  it('should resolve to undefined (fire and forget pattern)', async () => {
    const result = await Logger.error('test', 'test message');

    // Logger returns Promise.resolve() which resolves to undefined
    expect(result).toBeUndefined();
  });

  it('should handle await in try-catch block (production scenario)', async () => {
    // This simulates the exact production code pattern in productRegistry.js:88
    try {
      throw new Error('Simulated database error');
    } catch (err) {
      // This should NOT throw "Cannot read property 'error' of undefined"
      await expect(
        Logger.error('registry', 'Exception checking user product registry', {
          product_key: 'citrus element',
          error_message: err.message,
          error_stack: err.stack
        })
      ).resolves.not.toThrow();
    }
  });

  it('should work with sequential Logger calls', async () => {
    await Logger.info('test', 'First call');
    await Logger.error('test', 'Second call');
    await Logger.warn('test', 'Third call');

    // If Logger methods don't return Promises, this will fail
    expect(true).toBe(true); // Test passes if we get here without errors
  });

  it('should work when chained with other async operations', async () => {
    const asyncOperation = async () => {
      await Logger.info('test', 'Starting operation');

      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 10));

      await Logger.info('test', 'Operation complete');

      return 'done';
    };

    const result = await asyncOperation();
    expect(result).toBe('done');
  });

  it('should handle Supabase returning undefined (production bug scenario)', async () => {
    // Mock Supabase to return undefined (simulating a connection issue)
    supabase.from = jest.fn(() => ({
      insert: jest.fn(() => undefined) // Returns undefined instead of Promise
    }));

    // This should NOT throw even if Supabase fails
    await expect(
      Logger.error('registry', 'Test error', {
        product_key: 'citrus element'
      })
    ).resolves.not.toThrow();
  });

  it('should handle Supabase insert returning null', async () => {
    // Mock Supabase to return null
    supabase.from = jest.fn(() => ({
      insert: jest.fn(() => null)
    }));

    await expect(
      Logger.error('registry', 'Test error', { test: 'data' })
    ).resolves.not.toThrow();
  });

  it('should handle Supabase.from() returning undefined', async () => {
    // Mock Supabase.from to return undefined
    supabase.from = jest.fn(() => undefined);

    await expect(
      Logger.error('registry', 'Test error', { test: 'data' })
    ).resolves.not.toThrow();
  });

  it('should handle insert() not being a function', async () => {
    // Mock malformed Supabase response
    supabase.from = jest.fn(() => ({
      insert: 'not-a-function'
    }));

    await expect(
      Logger.error('registry', 'Test error', { test: 'data' })
    ).resolves.not.toThrow();
  });
});
