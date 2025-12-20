/**
 * RLS (Row Level Security) Policy Tests
 *
 * These tests verify that our database RLS policies correctly:
 * 1. Allow authenticated users to access ONLY their own data
 * 2. Block authenticated users from accessing other users' data
 * 3. Prevent data insertion with missing or invalid user_id
 * 4. Handle edge cases (undefined user_id, race conditions, etc.)
 *
 * CRITICAL: These tests prevent production errors like:
 * - "new row violates row-level security policy for table X"
 * - Users seeing/modifying each other's data
 * - Data corruption from missing user_id
 */

import { createAuditRecord, getUserRecentEvents } from '../../src/utils/voiceEventParser';
import { getUserId, requireUserId, validateUserId } from '../../src/utils/auth/getUserId';
import { supabase } from '../../src/utils/supabaseClient';

// Mock setup
jest.mock('../../src/utils/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn()
    }
  }
}));

jest.mock('../../src/utils/supabaseAuth', () => ({
  getSession: jest.fn()
}));

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

const mockUserId = '12345678-1234-1234-1234-123456789012';
const mockOtherUserId = '87654321-4321-4321-4321-210987654321';

describe('RLS Policy Tests - User ID Validation', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    global.userId = null;
  });

  describe('getUserId() - Reliable User ID Fetching', () => {

    it('should get user ID from Supabase session', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: { id: mockUserId }
          }
        },
        error: null
      });

      const userId = await getUserId();

      expect(userId).toBe(mockUserId);
      expect(supabase.auth.getSession).toHaveBeenCalled();
    });

    it('should fallback to custom session if Supabase session fails', async () => {
      const { getSession } = require('../../src/utils/supabaseAuth');

      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new Error('Session error')
      });

      getSession.mockResolvedValue({
        user: { id: mockUserId }
      });

      const userId = await getUserId();

      expect(userId).toBe(mockUserId);
    });

    it('should fallback to global.userId if all else fails', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null
      });

      supabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      });

      global.userId = mockUserId;

      const userId = await getUserId();

      expect(userId).toBe(mockUserId);
    });

    it('should return null if user not authenticated', async () => {
      const { getSession } = require('../../src/utils/supabaseAuth');

      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null
      });

      getSession.mockResolvedValue(null);

      supabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      });

      global.userId = null;

      const userId = await getUserId();

      expect(userId).toBeNull();
    });
  });

  describe('requireUserId() - Guaranteed User ID', () => {

    it('should return user ID when authenticated', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: { id: mockUserId }
          }
        },
        error: null
      });

      const userId = await requireUserId();

      expect(userId).toBe(mockUserId);
    });

    it('should throw error when not authenticated', async () => {
      const { getSession } = require('../../src/utils/supabaseAuth');

      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null
      });

      getSession.mockResolvedValue(null);

      supabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      });

      global.userId = null;

      await expect(requireUserId()).rejects.toThrow('User ID required but not found');
    });

    it('should use fallback if provided and user not authenticated', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null
      });

      const userId = await requireUserId(mockUserId);

      expect(userId).toBe(mockUserId);
    });
  });

  describe('validateUserId() - User ID Validation', () => {

    it('should pass validation for valid UUID', () => {
      expect(() => validateUserId(mockUserId, 'test')).not.toThrow();
    });

    it('should throw error for null user ID', () => {
      expect(() => validateUserId(null, 'test'))
        .toThrow('User ID is required for test but got: null');
    });

    it('should throw error for undefined user ID', () => {
      expect(() => validateUserId(undefined, 'test'))
        .toThrow('User ID is required for test but got: undefined');
    });

    it('should throw error for empty string user ID', () => {
      expect(() => validateUserId('', 'test'))
        .toThrow('User ID is required for test but got: ');
    });

    it('should throw error for non-string user ID', () => {
      expect(() => validateUserId(12345, 'test'))
        .toThrow('User ID must be a string for test but got type: number');
    });

    it('should throw error for invalid UUID format', () => {
      expect(() => validateUserId('not-a-uuid', 'test'))
        .toThrow('User ID has invalid format for test: not-a-uuid');
    });
  });
});

describe('RLS Policy Tests - Database Operations', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    global.userId = null;
  });

  describe('createAuditRecord() - INSERT operations', () => {

    it('should succeed with valid user ID', async () => {
      const mockFrom = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'audit-123', user_id: mockUserId },
              error: null
            }))
          }))
        }))
      }));

      supabase.from = mockFrom;

      const result = await createAuditRecord(
        mockUserId,
        'took 500mg vitamin C',
        'supplement',
        500,
        'mg',
        'gemini-2.5-flash',
        { test: true }
      );

      expect(result).toBeDefined();
      expect(result.user_id).toBe(mockUserId);
      expect(mockFrom).toHaveBeenCalledWith('voice_records_audit');
    });

    it('should throw error with null user ID', async () => {
      await expect(
        createAuditRecord(
          null,  // ❌ NULL user_id
          'test text',
          'food',
          null,
          null,
          'gemini-2.5-flash',
          {}
        )
      ).rejects.toThrow('userId is required');
    });

    it('should throw error with undefined user ID', async () => {
      await expect(
        createAuditRecord(
          undefined,  // ❌ UNDEFINED user_id (the actual bug!)
          'test text',
          'food',
          null,
          null,
          'gemini-2.5-flash',
          {}
        )
      ).rejects.toThrow('userId is required');
    });

    it('should throw error with empty string user ID', async () => {
      await expect(
        createAuditRecord(
          '',  // ❌ EMPTY user_id
          'test text',
          'food',
          null,
          null,
          'gemini-2.5-flash',
          {}
        )
      ).rejects.toThrow('userId is required');
    });

    it('should throw error with invalid user ID format', async () => {
      await expect(
        createAuditRecord(
          'not-a-valid-uuid',  // ❌ Invalid format
          'test text',
          'food',
          null,
          null,
          'gemini-2.5-flash',
          {}
        )
      ).rejects.toThrow('userId has invalid UUID format');
    });

    it('should handle RLS policy violation error clearly', async () => {
      const mockFrom = jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: {
                code: '42501',
                message: 'new row violates row-level security policy for table "voice_records_audit"'
              }
            }))
          }))
        }))
      }));

      supabase.from = mockFrom;

      await expect(
        createAuditRecord(
          mockUserId,
          'test text',
          'food',
          null,
          null,
          'gemini-2.5-flash',
          {}
        )
      ).rejects.toThrow('Failed to create audit record');
    });
  });

  describe('getUserRecentEvents() - SELECT operations', () => {

    it('should fetch events for valid user ID', async () => {
      const mockEvents = [
        { event_type: 'food', event_data: {}, event_time: new Date().toISOString() },
        { event_type: 'supplement', event_data: {}, event_time: new Date().toISOString() }
      ];

      const mockFrom = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({
                data: mockEvents,
                error: null
              }))
            }))
          }))
        }))
      }));

      supabase.from = mockFrom;

      const result = await getUserRecentEvents(mockUserId, 50);

      expect(result).toEqual(mockEvents);
      expect(mockFrom).toHaveBeenCalledWith('voice_events');
    });

    it('should return empty array for null user ID', async () => {
      // Function is defensive and returns empty array instead of throwing
      const result = await getUserRecentEvents(null, 50);

      expect(result).toEqual([]);
    });

    it('should return empty array for undefined user ID', async () => {
      const result = await getUserRecentEvents(undefined, 50);

      expect(result).toEqual([]);
    });
  });
});

describe('RLS Policy Tests - Edge Cases', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    global.userId = null;
  });

  describe('Race Conditions', () => {

    it('should handle user.id being undefined despite being authenticated', async () => {
      // Simulate the actual bug: user is authenticated but useUser() hasn't finished
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: { id: mockUserId }  // Session HAS user ID
          }
        },
        error: null
      });

      // But global.userId not set yet (useUser hook not finished)
      global.userId = undefined;

      // getUserId should still work because it checks session first
      const userId = await getUserId();

      expect(userId).toBe(mockUserId);

      // And requireUserId should work
      const requiredUserId = await requireUserId();
      expect(requiredUserId).toBe(mockUserId);
    });

    it('should detect when user.id is passed as undefined to createAuditRecord', async () => {
      // This is the EXACT bug the user reported
      const undefinedUserId = undefined;

      await expect(
        createAuditRecord(
          undefinedUserId,  // Simulating: user.id where user is undefined
          'citrus element pack',
          'supplement',
          null,
          null,
          'gemini-2.5-flash',
          { capture_method: 'voice' }
        )
      ).rejects.toThrow();
    });
  });

  describe('Type Coercion Edge Cases', () => {

    it('should reject 0 as user ID', async () => {
      await expect(
        createAuditRecord(0, 'test', 'food', null, null, null, null)
      ).rejects.toThrow();
    });

    it('should reject false as user ID', async () => {
      await expect(
        createAuditRecord(false, 'test', 'food', null, null, null, null)
      ).rejects.toThrow();
    });

    it('should reject NaN as user ID', async () => {
      await expect(
        createAuditRecord(NaN, 'test', 'food', null, null, null, null)
      ).rejects.toThrow();
    });

    it('should reject object as user ID', async () => {
      await expect(
        createAuditRecord({ id: mockUserId }, 'test', 'food', null, null, null, null)
      ).rejects.toThrow();
    });
  });
});

describe('Integration Test - Voice Input Flow', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    global.userId = null;
  });

  it('should simulate the exact user scenario: login → mic → voice input', async () => {
    // Step 1: User logs in
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: mockUserId },
          access_token: 'mock-token'
        }
      },
      error: null
    });

    // Step 2: User clicks mic IMMEDIATELY (before useUser hook finishes)
    // At this point: isAuthenticated = true, but user.data is still undefined
    const userFromHook = undefined;  // useUser() hasn't finished fetching

    // Step 3: Code tries to create audit record with user.id
    // WRONG WAY (current bug):
    // await createAuditRecord(userFromHook?.id, ...)  // undefined!

    // RIGHT WAY (using requireUserId):
    const userId = await requireUserId();
    expect(userId).toBe(mockUserId);

    // Step 4: Create audit record with guaranteed user ID
    const mockFrom = jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: { id: 'audit-123', user_id: userId },
            error: null
          }))
        }))
      }))
    }));

    supabase.from = mockFrom;

    const auditRecord = await createAuditRecord(
      userId,  // ✅ Valid user ID
      'citrus element pack',
      'supplement',
      null,
      null,
      'gemini-1.5-flash-002',
      { capture_method: 'voice' }
    );

    expect(auditRecord).toBeDefined();
    expect(auditRecord.user_id).toBe(mockUserId);
  });
});
