# RLS Policy Test Results

## ✅ All 29 Tests Passing (100%)

### Test Summary

**Test File**: `__tests__/database/rls-policies.test.js`

**Purpose**: Prevent RLS errors by validating user ID handling throughout the application

**Results**: ✅ **29/29 tests passing**

## Test Coverage

### 1. User ID Validation (12 tests)
- ✅ getUserId() fetches from Supabase session
- ✅ getUserId() falls back to custom session
- ✅ getUserId() falls back to global.userId
- ✅ getUserId() returns null when not authenticated
- ✅ requireUserId() returns ID when authenticated
- ✅ requireUserId() throws error when not authenticated
- ✅ requireUserId() uses fallback when provided
- ✅ validateUserId() passes for valid UUID
- ✅ validateUserId() rejects null
- ✅ validateUserId() rejects undefined
- ✅ validateUserId() rejects empty string
- ✅ validateUserId() rejects non-string types
- ✅ validateUserId() rejects invalid UUID format

### 2. Database Operations (7 tests)
- ✅ createAuditRecord() succeeds with valid user ID
- ✅ createAuditRecord() rejects null user ID
- ✅ createAuditRecord() rejects undefined user ID (THE BUG!)
- ✅ createAuditRecord() rejects empty string user ID
- ✅ createAuditRecord() rejects invalid UUID format
- ✅ createAuditRecord() handles RLS violation errors clearly
- ✅ getUserRecentEvents() fetches events for valid user ID
- ✅ getUserRecentEvents() returns empty array for null user ID
- ✅ getUserRecentEvents() returns empty array for undefined user ID

### 3. Edge Cases (6 tests)
- ✅ Handles race condition: user.id undefined despite being authenticated
- ✅ Detects when user.id passed as undefined to createAuditRecord
- ✅ Rejects 0 as user ID
- ✅ Rejects false as user ID
- ✅ Rejects NaN as user ID
- ✅ Rejects object as user ID

### 4. Integration Test (1 test)
- ✅ Simulates exact user scenario: login → mic → voice input

## Root Cause Identified

### The Bug
```javascript
// In home.jsx line 42:
const { data: user } = useUser();

// Later in line 160:
const auditRecord = await createAuditRecord(
  user.id,  // ❌ user is undefined!
  parsed.transcription,
  // ...
);
```

**Problem**: Race condition between `isAuthenticated` becoming true and `useUser()` fetching user data.

**User Experience**:
1. User logs in → `isAuthenticated` = true (UI shows initials)
2. User clicks mic IMMEDIATELY
3. `useUser()` hook hasn't finished fetching → `user` is still undefined
4. Code passes `user.id` = undefined to `createAuditRecord()`
5. RLS error: "new row violates row-level security policy"

## Fixes Implemented

### 1. Created `getUserId.js` Helper ✅
**File**: `mobile/src/utils/auth/getUserId.js`

Three new functions:
- `getUserId()` - Reliably fetches user ID from session (no race condition)
- `requireUserId()` - Throws clear error if not authenticated
- `validateUserId()` - Validates UUID format

### 2. Added Validation to `createAuditRecord()` ✅
**File**: `mobile/src/utils/voiceEventParser.js` (lines 286-313)

**Validations added**:
```javascript
// 1. Check userId is not null/undefined
if (!userId) {
  throw new Error('userId is required to create audit record');
}

// 2. Check userId is a string
if (typeof userId !== 'string') {
  throw new Error(`userId must be a string, got: ${typeof userId}`);
}

// 3. Check userId is valid UUID format
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(userId)) {
  throw new Error(`userId has invalid UUID format: ${userId}`);
}
```

**Result**: Now catches the bug BEFORE attempting database insert!

### 3. Added Validation to `getUserRecentEvents()` ✅
**File**: `mobile/src/utils/voiceEventParser.js` (lines 9-13)

**Defensive check**:
```javascript
if (!userId || typeof userId !== 'string') {
  console.warn('getUserRecentEvents called with invalid userId:', userId);
  return [];
}
```

**Result**: Returns empty array instead of querying with invalid userId

## Next Steps - Fix the Application Code

The tests now CATCH the bug, but we still need to FIX the code in `home.jsx`:

### Current Code (BROKEN):
```javascript
// home.jsx line 42
const { data: user } = useUser();

// home.jsx line 160
const auditRecord = await createAuditRecord(
  user.id,  // ❌ Can be undefined!
  parsed.transcription,
  // ...
);
```

### Fixed Code (OPTION 1 - Use requireUserId):
```javascript
import { requireUserId } from '@/utils/auth/getUserId';

// In handleVoicePress:
const userId = await requireUserId();  // ✅ Throws if not authenticated

const auditRecord = await createAuditRecord(
  userId,  // ✅ Guaranteed to be valid UUID
  parsed.transcription,
  // ...
);
```

### Fixed Code (OPTION 2 - Use global.userId):
```javascript
// In handleVoicePress:
const userId = user?.id || global.userId;

if (!userId) {
  Alert.alert('Error', 'Please log in to use this feature');
  return;
}

const auditRecord = await createAuditRecord(
  userId,  // ✅ Validated before use
  parsed.transcription,
  // ...
);
```

## Test Output

```
PASS __tests__/database/rls-policies.test.js
  RLS Policy Tests - User ID Validation
    getUserId() - Reliable User ID Fetching
      ✓ should get user ID from Supabase session (3 ms)
      ✓ should fallback to custom session if Supabase session fails (1 ms)
      ✓ should fallback to global.userId if all else fails (1 ms)
      ✓ should return null if user not authenticated (1 ms)
    requireUserId() - Guaranteed User ID
      ✓ should return user ID when authenticated (1 ms)
      ✓ should throw error when not authenticated (14 ms)
      ✓ should use fallback if provided and user not authenticated (1 ms)
    validateUserId() - User ID Validation
      ✓ should pass validation for valid UUID
      ✓ should throw error for null user ID (7 ms)
      ✓ should throw error for undefined user ID (2 ms)
      ✓ should throw error for empty string user ID (1 ms)
      ✓ should throw error for non-string user ID (1 ms)
      ✓ should throw error for invalid UUID format (1 ms)
  RLS Policy Tests - Database Operations
    createAuditRecord() - INSERT operations
      ✓ should succeed with valid user ID (1 ms)
      ✓ should throw error with null user ID (6 ms)
      ✓ should throw error with undefined user ID
      ✓ should throw error with empty string user ID (1 ms)
      ✓ should throw error with invalid user ID format (1 ms)
      ✓ should handle RLS policy violation error clearly (1 ms)
    getUserRecentEvents() - SELECT operations
      ✓ should fetch events for valid user ID
      ✓ should return empty array for null user ID
      ✓ should return empty array for undefined user ID
  RLS Policy Tests - Edge Cases
    Race Conditions
      ✓ should handle user.id being undefined despite being authenticated (1 ms)
      ✓ should detect when user.id is passed as undefined to createAuditRecord
    Type Coercion Edge Cases
      ✓ should reject 0 as user ID (1 ms)
      ✓ should reject false as user ID
      ✓ should reject NaN as user ID (1 ms)
      ✓ should reject object as user ID
  Integration Test - Voice Input Flow
    ✓ should simulate the exact user scenario: login → mic → voice input (1 ms)

Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
Snapshots:   0 total
Time:        0.983 s
```

## Summary

✅ **Root cause identified**: Race condition where `user.id` is undefined
✅ **29 comprehensive tests created** to catch this class of bugs
✅ **Validation added** to `createAuditRecord()` and `getUserRecentEvents()`
✅ **Helper functions created** for reliable userId fetching
✅ **All tests passing** - bug will be caught before reaching database

**Next Action**: Update `home.jsx` to use `requireUserId()` instead of `user.id`
