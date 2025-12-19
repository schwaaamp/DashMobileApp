# Logging Test Plan

## Overview

This document outlines test cases to ensure logs are written correctly as users engage with the logging capability. Tests are organized by user flow and verify that all critical events are logged with proper metadata.

## Test Environment Setup

### Prerequisites

1. **Test Database**: Separate Supabase project for testing
2. **Tables Created**: Run migration `001_create_app_logs_table.sql`
3. **Test User**: Create a test user in Supabase auth
4. **Environment Variables**: Set test database credentials

### Test Database Configuration

```javascript
// jest.setup.js or test-specific config
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-anon-key';
```

## Test Categories

### 1. Unit Tests (Mocked Supabase)

**File**: `__tests__/logging/logging-integration.test.js`

**Purpose**: Fast tests that verify logging logic without database

**Coverage**:
- ✅ Logger writes entries with all required fields
- ✅ user_id is included (parameter or global)
- ✅ Sensitive data is sanitized
- ✅ Correct log levels are used
- ✅ Session IDs are consistent
- ✅ Metadata is complete

**Run**: `npm test -- logging-integration.test.js`

### 2. Integration Tests (Real Database)

**Purpose**: Verify logs actually reach the database

**Setup Required**:
```javascript
// Use real Supabase client for these tests
// Don't mock supabaseClient
```

**Manual Verification**:
```sql
-- Check recent logs
SELECT * FROM app_logs
WHERE created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC;

-- Check logs by category
SELECT category, level, COUNT(*)
FROM app_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY category, level;
```

### 3. End-to-End Tests (Real App Flow)

**Purpose**: Test logging in actual user scenarios

**Test in Emulator/Device**:
1. Run app in development mode
2. Perform user actions
3. Check logs in Supabase
4. Verify metadata completeness

## Test Cases by User Flow

### Flow 1: Voice Input - Successful Parse

**User Actions**:
1. User signs in
2. User clicks microphone
3. User says "log 6 units of insulin"
4. App transcribes and parses successfully
5. App creates event

**Expected Logs** (in order):

| Category | Message | Required Metadata |
|----------|---------|-------------------|
| `voice_processing` | "Starting text input processing" | `input_text`, `capture_method='voice'`, `user_id` |
| `api` | "Claude call" | `endpoint='/v1/messages'`, `duration_ms`, `response_status=200`, `user_id` |
| `parsing` | "Received Claude API response" | `response_length`, `response_preview`, `user_id` |
| `parsing` | "Extracted JSON from response" | `extracted_json_preview`, `user_id` |
| `parsing` | "Parsing succeeded" | `result_type`, `user_id` |
| `parsing` | "Successfully parsed event" | `event_type`, `complete`, `confidence`, `user_id` |

**Verification Query**:
```sql
SELECT category, message, metadata->>'input_text' as input
FROM app_logs
WHERE session_id = '<test-session-id>'
AND category IN ('voice_processing', 'parsing', 'api')
ORDER BY created_at ASC;
```

**Expected**: 6 log entries with proper sequence

### Flow 2: Voice Input - Parse Error

**User Actions**:
1. User says something that causes Claude API to return invalid JSON
2. App shows error

**Expected Logs**:

| Category | Level | Message | Required Metadata |
|----------|-------|---------|-------------------|
| `voice_processing` | `info` | "Starting text input processing" | `input_text`, `user_id` |
| `api` | `info` | "Claude call" | `response_status=200`, `user_id` |
| `parsing` | `info` | "Received Claude API response" | `response_preview`, `user_id` |
| `parsing` | `error` | "Failed to extract JSON from Claude response" | `raw_response`, `user_id` |
| `parsing` | `error` | "parseTextWithClaude failed" | `error_message`, `error_stack`, `user_id` |
| `voice_processing` | `error` | "processTextInput failed" | `error_message`, `user_id` |

**Verification Query**:
```sql
SELECT level, category, message, metadata->>'error_message' as error
FROM app_logs
WHERE level = 'error'
AND category IN ('parsing', 'voice_processing')
ORDER BY created_at DESC
LIMIT 10;
```

**Expected**: Error logs with full error context

### Flow 3: Product Search - Phonetic Matching

**User Actions**:
1. User says "citrus element pack"
2. App searches for products
3. Phonetic variations created ("lmnt")
4. Products found

**Expected Logs**:

| Category | Message | Required Metadata |
|----------|---------|-------------------|
| `product_search` | "Starting product search" | `query='citrus element pack'`, `query_length` |
| `product_search` | "Created phonetic variations" | `variations=['lmnt citrus pck', ...]`, `variations_count` |
| `api` | "OpenFoodFacts call" | `duration_ms`, `response_status` |
| `product_search` | "Open Food Facts search completed" | `query`, `results_count`, `duration_ms` |
| `api` | "USDA call" | `duration_ms`, `response_status` |
| `product_search` | "USDA search completed" | `query`, `results_count` |
| `product_search` | "Product search completed" | `total_unique_products`, `top_10_results` |

**Verification Query**:
```sql
SELECT message, metadata->>'query' as query, metadata->>'variations' as variations
FROM app_logs
WHERE category = 'product_search'
AND metadata->>'query' = 'citrus element pack'
ORDER BY created_at ASC;
```

**Expected**: 7 log entries showing complete search flow

### Flow 4: API Call Failures

**User Actions**:
1. Disable network or use invalid API key
2. Attempt voice input
3. API call fails

**Expected Logs**:

| Category | Level | Message | Required Metadata |
|----------|-------|---------|-------------------|
| `api` | `info` | "Claude call" | `response_status=401`, `response_ok=false` |
| `parsing` | `error` | "parseTextWithClaude failed" | `error_message='Claude API error'` |

**Verification Query**:
```sql
SELECT metadata->>'response_status' as status, metadata->>'error_message' as error
FROM app_logs
WHERE category = 'api'
AND (metadata->>'response_ok')::boolean = false
ORDER BY created_at DESC;
```

### Flow 5: Multiple Users - Isolation

**User Actions**:
1. User A logs event
2. User B logs event
3. Verify logs are isolated by user_id

**Expected Logs**:
- User A's logs have `user_id = 'user-a-id'`
- User B's logs have `user_id = 'user-b-id'`

**Verification Query**:
```sql
-- User A should only see their logs
SELECT COUNT(*)
FROM app_logs
WHERE user_id = '<user-a-id>'
AND created_at > NOW() - INTERVAL '5 minutes';

-- Should be > 0

-- User A should NOT see User B's logs
SELECT COUNT(*)
FROM app_logs
WHERE user_id = '<user-b-id>'
AND created_at > NOW() - INTERVAL '5 minutes';

-- Should be 0 (if RLS is working correctly)
```

## Critical Test Scenarios

### Scenario 1: "Citrus Element Pack" Bug

**Purpose**: Verify we capture enough information to debug the original error

**Test Steps**:
1. User says "citrus element pack"
2. Check logs for:
   - Raw Claude API response
   - Extracted JSON
   - Product search queries
   - Phonetic variations

**Success Criteria**:
```sql
-- Should find the exact input
SELECT * FROM app_logs
WHERE metadata->>'input_text' = 'citrus element pack';

-- Should see the raw API response
SELECT metadata->>'response_preview'
FROM app_logs
WHERE category = 'parsing'
AND message = 'Received Claude API response'
AND metadata->>'input_text' = 'citrus element pack';

-- Should see phonetic variations
SELECT metadata->>'variations'
FROM app_logs
WHERE category = 'product_search'
AND metadata->>'original_query' = 'citrus element pack';
```

### Scenario 2: Missing user_id

**Purpose**: Verify all logs include user_id

**Test Steps**:
1. Process any voice input
2. Check all logs have user_id

**Success Criteria**:
```sql
-- Should be 0
SELECT COUNT(*)
FROM app_logs
WHERE user_id IS NULL
AND created_at > NOW() - INTERVAL '5 minutes';
```

### Scenario 3: PII Sanitization

**Purpose**: Verify sensitive data is redacted

**Test Steps**:
1. Process input with sensitive data in metadata
2. Verify it's redacted in logs

**Success Criteria**:
```sql
-- Check that API keys are redacted
SELECT metadata
FROM app_logs
WHERE metadata ? 'api_key'
AND created_at > NOW() - INTERVAL '5 minutes';

-- Should show: { "api_key": "[REDACTED]" }
```

### Scenario 4: Session Consistency

**Purpose**: Verify session_id stays consistent across a user flow

**Test Steps**:
1. User performs one complete voice input flow
2. Check all logs share same session_id

**Success Criteria**:
```sql
-- Get session ID from first log
WITH first_session AS (
  SELECT session_id
  FROM app_logs
  WHERE category = 'voice_processing'
  AND message = 'Starting text input processing'
  ORDER BY created_at DESC
  LIMIT 1
)
-- Count logs with different session_id in same timeframe
SELECT COUNT(DISTINCT session_id)
FROM app_logs, first_session
WHERE created_at BETWEEN
  (SELECT created_at FROM app_logs WHERE session_id = first_session.session_id ORDER BY created_at ASC LIMIT 1)
  AND
  (SELECT created_at FROM app_logs WHERE session_id = first_session.session_id ORDER BY created_at DESC LIMIT 1);

-- Should be 1
```

## Performance Test Cases

### Test 1: Logging Doesn't Block UI

**Purpose**: Verify async logging doesn't freeze the app

**Test**:
```javascript
it('should not block on log write', async () => {
  const start = Date.now();
  await Logger.info('test', 'Test message', {}, userId);
  const duration = Date.now() - start;

  // Should complete in < 50ms (fire and forget)
  expect(duration).toBeLessThan(50);
});
```

### Test 2: High Volume Logging

**Purpose**: Verify logging handles bursts

**Test**:
```javascript
it('should handle 100 logs in quick succession', async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(Logger.info('test', `Message ${i}`, {}, userId));
  }

  await Promise.all(promises);

  // Verify all logs were attempted (may need to check Supabase)
  // This tests that the logger doesn't crash or drop logs
});
```

## Automated Test Execution

### Run All Logging Tests

```bash
# Unit tests (mocked)
npm test -- __tests__/logging/

# Integration tests (requires test DB)
npm test -- __tests__/logging/ --testEnvironment=integration

# E2E tests (requires running app)
npm run test:e2e -- logging
```

### Continuous Integration

```yaml
# .github/workflows/test-logging.yml
name: Logging Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node
        uses: actions/setup-node@v2
      - name: Install dependencies
        run: cd mobile && npm install
      - name: Run logging tests
        run: cd mobile && npm test -- __tests__/logging/
        env:
          EXPO_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          EXPO_PUBLIC_SUPABASE_KEY: ${{ secrets.TEST_SUPABASE_KEY }}
```

## Manual Testing Checklist

- [ ] Run SQL migration to create app_logs table
- [ ] Set `global.userId` on app login
- [ ] Test voice input: "log 6 units of insulin"
  - [ ] Check app_logs for voice_processing logs
  - [ ] Verify user_id is present
  - [ ] Verify session_id is consistent
- [ ] Test voice input: "citrus element pack"
  - [ ] Check app_logs for product_search logs
  - [ ] Verify phonetic variations logged
  - [ ] Verify API calls logged with timing
- [ ] Test with invalid API key
  - [ ] Verify error logs captured
  - [ ] Verify error has full stack trace
- [ ] Test with network disconnected
  - [ ] Verify API failure logged
  - [ ] App doesn't crash
- [ ] Check RLS policies
  - [ ] User can read their own logs
  - [ ] User cannot read other users' logs
- [ ] Check PII sanitization
  - [ ] API keys are `[REDACTED]`
  - [ ] Email addresses are `[REDACTED]`
  - [ ] Event data structure is preserved

## Success Criteria

### All Tests Must Pass
- ✅ Unit tests: 100% pass rate
- ✅ Integration tests: Logs reach database
- ✅ E2E tests: Full user flows logged

### Database Verification
- ✅ app_logs table has entries
- ✅ All entries have `user_id`
- ✅ All entries have `session_id`
- ✅ Timestamps are correct
- ✅ No sensitive data in metadata

### Error Handling
- ✅ Parse errors fully logged
- ✅ API errors fully logged
- ✅ Network errors fully logged
- ✅ App doesn't crash on logging errors

## Troubleshooting

### No Logs Appearing in Database

**Check**:
1. Table exists: `SELECT * FROM information_schema.tables WHERE table_name = 'app_logs';`
2. RLS allows inserts: `SELECT * FROM pg_policies WHERE tablename = 'app_logs';`
3. user_id is set: `console.log(global.userId)` in app
4. Console shows errors: Check for "Failed to store log" messages

### Logs Missing user_id

**Fix**:
1. Ensure `global.userId = user.id` is set on login
2. Pass userId parameter to Logger calls: `Logger.info('test', 'msg', {}, userId)`
3. Check logger.js has `user_id: userId || global.userId || null`

### RLS Blocking Inserts

**Fix**:
1. Check policy: `auth.uid() = user_id` requires matching IDs
2. Verify user is authenticated: `SELECT auth.uid();` should return user ID
3. Try manual insert to verify: `INSERT INTO app_logs (user_id, ...) VALUES (auth.uid(), ...);`
