# "Failed to Create Audit Record" Error Analysis

## Problem Statement

**User Action**: Signed in → Clicked microphone → Said "citrus element pack" → Submitted
**Error**: "failed to create audit record"
**Critical Issue**: No logs in `app_logs` table
**Test Status**: All tests pass ✅
**Production Status**: Feature broken ❌

## Root Cause Analysis

### Why Tests Passed But Production Failed

#### 1. **Logger.js Requires Supabase Connection**

The logger writes to Supabase's `app_logs` table:

```javascript
// logger.js line 102
supabase.from('app_logs').insert(logEntry).then(({ error }) => {
  if (error && __DEV__) {
    console.error('Failed to store log:', error);
  }
});
```

**Problem**: If the `app_logs` table doesn't exist OR if there's an RLS (Row Level Security) issue, logs fail silently.

**Why tests passed**: Tests mock Supabase, so the logger never actually tries to write to a real database.

#### 2. **Migration Not Run**

**Critical Discovery**: The SQL migration file exists at:
```
/mobile/supabase_migrations/001_create_app_logs_table.sql
```

But **it was never executed** in your Supabase project.

**Evidence**:
- You said "there is nothing in the app_logs table"
- The table likely doesn't exist at all
- If it doesn't exist, `supabase.from('app_logs').insert()` fails
- The logger catches the error and silently continues (by design - "fire and forget")

#### 3. **Silent Failure by Design**

The logger is designed to never block the app:

```javascript
try {
  // Fire and forget - don't await to avoid blocking
  supabase.from('app_logs').insert(logEntry).then(({ error }) => {
    if (error && __DEV__) {
      console.error('Failed to store log:', error);
    }
  });
} catch (error) {
  // Fallback: log to console if Supabase fails
  if (__DEV__) {
    console.error('Failed to store log:', error);
  }
}
```

**Problem**: If you're not in `__DEV__` mode (production build), you'd never see the error.

### Why "Failed to Create Audit Record"

The error message "failed to create audit record" comes from `createAuditRecord()`:

```javascript
// voiceEventParser.js line 218
export async function createAuditRecord(userId, rawText, eventType, value, units, nlpModel = null, nlpMetadata = null) {
  const { data, error } = await supabase
    .from('voice_records_audit')
    .insert({
      user_id: userId,
      raw_text: rawText,
      record_type: eventType || 'unknown',
      value: value || null,
      units: units || null,
      nlp_status: 'pending',
      nlp_model: nlpModel,
      nlp_metadata: nlpMetadata
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating audit record:', error);
    throw new Error('Failed to create audit record');
  }

  return data;
}
```

**Possible causes**:

1. **Table doesn't exist**: `voice_records_audit` table missing
2. **RLS Policy Block**: User doesn't have INSERT permission
3. **Invalid user_id**: The `userId` is null or invalid
4. **Foreign key constraint**: `user_id` references `auth.users(id)` but user doesn't exist in auth table
5. **Column mismatch**: Schema changed but code wasn't updated

## Why No Logs in app_logs Table

### Hypothesis 1: Table Doesn't Exist (Most Likely)

**Test**:
```sql
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'app_logs'
);
```

If this returns `false`, the table doesn't exist.

**Fix**: Run the migration:
```sql
-- Run /mobile/supabase_migrations/001_create_app_logs_table.sql
```

### Hypothesis 2: RLS Blocking Inserts

Even if the table exists, Row Level Security might block inserts.

**Test**:
```sql
-- Check RLS status
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'app_logs';

-- Check policies
SELECT * FROM pg_policies WHERE tablename = 'app_logs';
```

**Expected policy**:
```sql
CREATE POLICY "Users can insert their own logs"
  ON app_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

**Problem**: If `auth.uid()` is null (user not authenticated), inserts fail.

### Hypothesis 3: Logger Gets User ID Wrong

The logger needs the user ID:

```javascript
// logger.js - PROBLEM: How does it get user_id?
const logEntry = {
  timestamp: new Date().toISOString(),
  level,
  category,
  message,
  metadata: sanitize(metadata),
  session_id: global.sessionId || 'unknown',
  app_version: getAppVersion(),
  platform: Platform.OS
  // ❌ MISSING: user_id is never set!
};
```

**CRITICAL BUG FOUND**: The logger doesn't include `user_id` in log entries!

**Impact**:
- Log entries fail RLS check because `user_id` is null
- RLS policy requires `auth.uid() = user_id`
- If `user_id` is null, check fails, insert rejected

## Debugging Steps

### Step 1: Check if app_logs table exists

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'app_logs';
```

**If empty**: Run the migration SQL

### Step 2: Check if voice_records_audit table exists

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'voice_records_audit';
```

### Step 3: Check RLS policies

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('app_logs', 'voice_records_audit');
```

### Step 4: Test manual insert

```sql
-- Try inserting a test log (as authenticated user)
INSERT INTO app_logs (
  timestamp,
  level,
  category,
  message,
  session_id,
  user_id,
  platform
) VALUES (
  NOW(),
  'info',
  'test',
  'Test log entry',
  'test-session',
  auth.uid(), -- Your user ID
  'ios'
);
```

If this fails, check the error message.

### Step 5: Check user authentication

```javascript
// In the app, add console.log
const { data: user } = useUser();
console.log('User ID:', user?.id);
console.log('User email:', user?.email);
```

Verify the user ID matches what's in Supabase auth.users table.

## Fixes Required

### Fix 1: Run Database Migrations

**Priority**: CRITICAL
**Action**: Run `001_create_app_logs_table.sql` in Supabase SQL Editor

### Fix 2: Add user_id to Logger

**Priority**: CRITICAL
**File**: `/mobile/src/utils/logger.js`

**Problem**: Logger doesn't capture user_id
**Solution**: Pass userId to logger functions

**Option A - Modify log() function signature**:
```javascript
async function log(level, category, message, metadata = {}, userId = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    metadata: sanitize(metadata),
    session_id: global.sessionId || 'unknown',
    app_version: getAppVersion(),
    platform: Platform.OS,
    user_id: userId  // ✅ Add user_id
  };
  // ... rest of function
}
```

**Option B - Get userId from global state** (if available):
```javascript
// Set global user ID on login
global.userId = user.id;

// In logger
const logEntry = {
  // ...
  user_id: global.userId || null
};
```

### Fix 3: Update Logger Calls to Include userId

**Files to update**:
- `voiceEventParser.js` - Pass `userId` to all Logger calls
- `productSearch.js` - Pass `userId` to all Logger calls

**Example**:
```javascript
// Before
await Logger.info('voice_processing', 'Starting text input processing', {
  input_text: text,
  // ...
});

// After
await Logger.info('voice_processing', 'Starting text input processing', {
  input_text: text,
  // ...
}, userId);
```

### Fix 4: Check voice_records_audit Table Schema

Verify the table has proper columns and RLS:

```sql
-- Check schema
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'voice_records_audit';

-- Check RLS
SELECT * FROM pg_policies WHERE tablename = 'voice_records_audit';
```

### Fix 5: Add Better Error Logging

**File**: `voiceEventParser.js`

**Current**:
```javascript
if (error) {
  console.error('Error creating audit record:', error);
  throw new Error('Failed to create audit record');
}
```

**Improved**:
```javascript
if (error) {
  console.error('Error creating audit record:', error);
  console.error('Error details:', JSON.stringify(error, null, 2));
  console.error('User ID:', userId);
  console.error('Raw text:', rawText);
  throw new Error(`Failed to create audit record: ${error.message || JSON.stringify(error)}`);
}
```

## Testing Strategy After Fixes

### 1. Manual Test in Supabase

```sql
-- Test app_logs insert
INSERT INTO app_logs (timestamp, level, category, message, user_id, platform)
VALUES (NOW(), 'info', 'test', 'Manual test', '<your-user-id>', 'ios');

-- Verify
SELECT * FROM app_logs WHERE category = 'test';
```

### 2. Test Logger in App

Add temporary test code in home.jsx:

```javascript
useEffect(() => {
  if (user?.id) {
    Logger.info('test', 'App loaded', { user_id: user.id }, user.id);
  }
}, [user]);
```

Check if log appears in database.

### 3. Test Voice Flow

1. Click microphone
2. Say "test"
3. Check console for errors
4. Check `app_logs` table for:
   - voice_processing logs
   - parsing logs
   - api logs
5. Check `voice_records_audit` table for audit entry

## Summary

**Why tests passed**: Mocked Supabase never touches real database
**Why production failed**: Database tables don't exist OR RLS blocks inserts
**Why no logs**: Logger can't write to non-existent table + missing user_id
**Critical fixes**:
1. Run SQL migration to create app_logs table
2. Add user_id parameter to logger
3. Verify voice_records_audit table exists
4. Check RLS policies allow inserts
