/**
 * Reliable user ID fetching utilities
 *
 * CRITICAL: Always use these functions instead of relying on useUser() hook
 * to avoid race conditions where user.id is undefined despite being authenticated.
 */

import { getSession } from '../supabaseAuth';
import { supabase } from '../supabaseClient';

/**
 * Get current authenticated user's ID from the session
 *
 * This is more reliable than useUser() hook because it reads directly
 * from the auth session without requiring a separate database query.
 *
 * @returns {Promise<string|null>} User ID or null if not authenticated
 */
export async function getUserId() {
  try {
    // First try: Get from Supabase session
    const { data: { session }, error } = await supabase.auth.getSession();

    if (!error && session?.user?.id) {
      return session.user.id;
    }

    // Second try: Get from our custom session storage
    const customSession = await getSession();
    if (customSession?.user?.id) {
      return customSession.user.id;
    }

    // Third try: Fetch user from API
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (!userError && user?.id) {
      return user.id;
    }

    // Fallback: Check global state (set by useUser hook)
    if (global.userId) {
      return global.userId;
    }

    console.warn('Unable to get user ID - user may not be authenticated');
    return null;
  } catch (error) {
    console.error('Unexpected error getting user ID:', error);

    // Last resort: Check global state
    return global.userId || null;
  }
}

/**
 * Get user ID synchronously from global state
 *
 * WARNING: Only use this if you're certain the user is authenticated
 * and global.userId has been set. Prefer getUserId() for reliability.
 *
 * @returns {string|null} User ID from global state
 */
export function getUserIdSync() {
  return global.userId || null;
}

/**
 * Get user ID with guarantee - throws if not authenticated
 *
 * Use this when user MUST be authenticated for the operation to proceed.
 * Throws a clear error if user ID cannot be obtained.
 *
 * @param {string|null} fallback - Optional fallback user ID
 * @returns {Promise<string>} User ID (never null - throws instead)
 * @throws {Error} If user ID cannot be obtained and no fallback provided
 */
export async function requireUserId(fallback = null) {
  const userId = await getUserId();

  if (userId) {
    return userId;
  }

  if (fallback) {
    console.warn('Using fallback user ID:', fallback);
    return fallback;
  }

  const error = new Error('User ID required but not found - user may not be authenticated');
  console.error('requireUserId failed:', {
    globalUserId: global.userId,
    hasSupabase: !!supabase,
    timestamp: new Date().toISOString(),
    stack: error.stack
  });

  throw error;
}

/**
 * Validate that a user ID is present and valid
 *
 * @param {any} userId - The user ID to validate
 * @param {string} context - Context for error message (e.g., "creating audit record")
 * @throws {Error} If userId is null, undefined, or invalid
 */
export function validateUserId(userId, context = 'operation') {
  if (!userId) {
    throw new Error(`User ID is required for ${context} but got: ${userId}`);
  }

  if (typeof userId !== 'string') {
    throw new Error(`User ID must be a string for ${context} but got type: ${typeof userId}`);
  }

  // Basic UUID format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    throw new Error(`User ID has invalid format for ${context}: ${userId}`);
  }

  return true;
}
