/**
 * Shared Supabase Mock Helper
 *
 * Provides comprehensive Supabase client mocking that handles all tables
 * including Phase 2+ features (user_product_registry, classification_corrections)
 *
 * Usage:
 *   import { createSupabaseMock } from '../helpers/supabaseMock.helper';
 *
 *   beforeEach(() => {
 *     supabase.from = createSupabaseMock();
 *   });
 *
 *   // With custom voice_events data:
 *   supabase.from = createSupabaseMock({ voiceEvents: mockHistory });
 */

/**
 * Create comprehensive Supabase mock
 *
 * @param {Object} options - Configuration options
 * @param {Array} options.voiceEvents - Custom voice_events data to return
 * @param {Array} options.auditRecords - Custom voice_records_audit data
 * @param {Array} options.registryEntries - Custom user_product_registry data
 * @param {string} options.auditId - Mock audit record ID (default: 'audit-mock-123')
 * @returns {Function} Jest mock function for supabase.from()
 */
export function createSupabaseMock(options = {}) {
  const {
    voiceEvents = [],
    auditRecords = [],
    registryEntries = [],
    auditId = 'audit-mock-123'
  } = options;

  return jest.fn((table) => {
    // Common chain methods that work across all queries
    // Track filter criteria for smart filtering
    const filterState = {
      eq: {},
      gte: {}
    };

    const selectChain = {
      eq: jest.fn(function(field, value) {
        filterState.eq[field] = value;
        return selectChain;
      }),
      order: jest.fn(function() { return selectChain; }),
      gte: jest.fn(function(field, value) {
        filterState.gte[field] = value;
        return selectChain;
      }),
      limit: jest.fn(() => {
        // Apply filters to data before returning
        let filtered = [];

        if (table === 'voice_events') {
          filtered = voiceEvents;
        } else if (table === 'voice_records_audit') {
          filtered = auditRecords;
        } else if (table === 'user_product_registry') {
          filtered = registryEntries;
        }

        // Apply .eq() filters
        Object.keys(filterState.eq).forEach(field => {
          const value = filterState.eq[field];
          filtered = filtered.filter(item => item[field] === value);
        });

        // Apply .gte() filters
        Object.keys(filterState.gte).forEach(field => {
          const value = filterState.gte[field];
          filtered = filtered.filter(item => item[field] >= value);
        });

        return Promise.resolve({ data: filtered, error: null });
      }),
      single: jest.fn(() => {
        // Apply filters before returning single result
        let filtered = [];

        if (table === 'user_product_registry') {
          filtered = registryEntries;
        } else if (table === 'voice_events') {
          filtered = voiceEvents;
        } else if (table === 'voice_records_audit') {
          filtered = auditRecords;
        }

        // Apply .eq() filters
        Object.keys(filterState.eq).forEach(field => {
          const value = filterState.eq[field];
          filtered = filtered.filter(item => item[field] === value);
        });

        // Apply .gte() filters
        Object.keys(filterState.gte).forEach(field => {
          const value = filterState.gte[field];
          filtered = filtered.filter(item => item[field] >= value);
        });

        const entry = filtered.length > 0 ? filtered[0] : null;
        return Promise.resolve({
          data: entry,
          error: entry ? null : { code: 'PGRST116' }
        });
      })
    };

    // insertChain needs to be both thenable (for .insert().then())
    // and have .select() method (for .insert().select().single())
    const insertPromise = Promise.resolve({
      data: { id: auditId },
      error: null
    });

    const insertChain = Object.assign(insertPromise, {
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: { id: auditId },
          error: null
        }))
      }))
    });

    const updateChain = {
      eq: jest.fn(() => Promise.resolve({ error: null }))
    };

    // Table-specific mocks

    if (table === 'user_product_registry') {
      return {
        select: jest.fn(() => selectChain),
        insert: jest.fn(() => insertChain),
        update: jest.fn(() => updateChain)
      };
    }

    if (table === 'voice_events') {
      return {
        select: jest.fn(() => selectChain),
        insert: jest.fn((data) => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                id: 'event-new',
                ...(Array.isArray(data) ? data[0] : data)
              },
              error: null
            }))
          }))
        }))
      };
    }

    if (table === 'voice_records_audit') {
      return {
        select: jest.fn(() => selectChain),
        insert: jest.fn((data) => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                id: auditId,
                ...(Array.isArray(data) ? data[0] : data)
              },
              error: null
            }))
          }))
        })),
        update: jest.fn(() => updateChain)
      };
    }

    if (table === 'classification_corrections') {
      return {
        select: jest.fn(() => selectChain),
        insert: jest.fn(() => insertChain)
      };
    }

    // Default fallback for any other table (including app_logs)
    return {
      select: jest.fn(() => selectChain),
      insert: jest.fn(() => insertChain),
      update: jest.fn(() => updateChain)
    };
  });
}

/**
 * Create a simple mock for tests that don't need custom data
 *
 * @param {string} auditId - Mock audit ID to use
 * @returns {Function} Jest mock function
 */
export function createSimpleMock(auditId = 'audit-mock-123') {
  return createSupabaseMock({ auditId });
}
