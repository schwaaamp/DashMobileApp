# Logging Infrastructure Setup

This document explains how to set up and use the comprehensive logging infrastructure for debugging production issues.

## Overview

We've implemented a logging-first observability strategy that captures:
- API calls (timing, status, request/response metadata)
- Parsing attempts (input, output, errors)
- Product searches (queries, phonetic variations, results)
- User actions (interactions, navigation)
- Errors and exceptions (with full stack traces)

All logs are:
- **Sanitized** to remove PII and sensitive data
- **Structured** as JSON for easy querying
- **Stored** in Supabase for persistence
- **Categorized** for efficient filtering

## Step 1: Create Database Table

Run the SQL migration in your Supabase SQL editor:

```bash
# The migration file is located at:
mobile/supabase_migrations/001_create_app_logs_table.sql
```

This will create:
- `app_logs` table with proper indexes
- Row Level Security policies
- Useful views: `recent_errors`, `parsing_errors`, `api_call_logs`

## Step 2: Verify the Table

After running the migration, verify the table exists:

```sql
SELECT * FROM app_logs LIMIT 1;
```

You should see the table structure with columns:
- `id`, `created_at`, `timestamp`
- `level`, `category`, `message`
- `session_id`, `user_id`
- `app_version`, `platform`
- `metadata` (JSONB)

## Step 3: Test Logging

The logging is already integrated into:
- ✅ `/mobile/src/utils/voiceEventParser.js` - Voice input processing
- ✅ `/mobile/src/utils/productSearch.js` - Product database searches
- ✅ `/mobile/src/utils/logger.js` - Core logging utility

To test, run the app and try the "citrus element pack" input that previously failed:

```bash
# In mobile directory
npm run android
# or
npm run ios
```

Then:
1. Sign in
2. Click microphone
3. Say "citrus element pack"
4. Check the logs in Supabase

## Step 4: Query Logs in Supabase

### Recent Parsing Errors

```sql
SELECT * FROM parsing_errors
ORDER BY created_at DESC
LIMIT 20;
```

This shows:
- Input text that failed to parse
- Error messages
- Raw API responses
- Timestamps

### API Call Performance

```sql
SELECT * FROM api_call_logs
WHERE metadata->>'endpoint' = '/v1/messages'
ORDER BY created_at DESC
LIMIT 20;
```

This shows:
- API response times
- Success/failure status
- Request metadata

### All Errors for a Session

```sql
SELECT
  created_at,
  category,
  message,
  metadata->>'error_message' as error,
  metadata->>'input_text' as input
FROM app_logs
WHERE session_id = 'your-session-id-here'
  AND level = 'error'
ORDER BY created_at DESC;
```

### Product Search Analysis

```sql
SELECT
  created_at,
  message,
  metadata->>'query' as search_query,
  metadata->>'variations' as phonetic_variations,
  metadata->>'results_count' as results
FROM app_logs
WHERE category = 'product_search'
ORDER BY created_at DESC
LIMIT 50;
```

## Debugging "citrus element pack" Error

When you reproduce the error, check these logs in sequence:

### 1. Voice Processing Start
```sql
SELECT * FROM app_logs
WHERE category = 'voice_processing'
  AND message = 'Starting text input processing'
  AND metadata->>'input_text' LIKE '%citrus element pack%'
ORDER BY created_at DESC
LIMIT 1;
```

### 2. Claude API Call
```sql
SELECT * FROM app_logs
WHERE category = 'api'
  AND metadata->>'endpoint' = '/v1/messages'
  AND created_at > (
    SELECT created_at FROM app_logs
    WHERE metadata->>'input_text' LIKE '%citrus element pack%'
    ORDER BY created_at DESC
    LIMIT 1
  )
ORDER BY created_at DESC
LIMIT 1;
```

This shows:
- API response time
- HTTP status code
- Success/failure

### 3. Raw API Response
```sql
SELECT
  created_at,
  metadata->>'response_preview' as raw_response
FROM app_logs
WHERE category = 'parsing'
  AND message = 'Received Claude API response'
  AND metadata->>'input_text' LIKE '%citrus element pack%'
ORDER BY created_at DESC
LIMIT 1;
```

**This is the critical log** - it shows exactly what Claude returned before we tried to parse it.

### 4. Parsing Error
```sql
SELECT * FROM parsing_errors
WHERE metadata->>'input_text' LIKE '%citrus element pack%'
ORDER BY created_at DESC
LIMIT 1;
```

This shows:
- What JSON extraction method failed
- The exact error message
- The malformed JSON string

### 5. Product Search Behavior
```sql
SELECT
  created_at,
  message,
  metadata
FROM app_logs
WHERE category = 'product_search'
  AND created_at > (
    SELECT created_at FROM app_logs
    WHERE metadata->>'input_text' LIKE '%citrus element pack%'
    ORDER BY created_at DESC
    LIMIT 1
  )
ORDER BY created_at ASC;
```

This shows:
- What phonetic variations were created ("element" → "lmnt")
- What products were found
- Whether LMNT was matched

## Log Categories

- `voice_processing` - Overall voice input flow
- `parsing` - Text parsing and JSON extraction
- `api` - External API calls (Claude, Open Food Facts, USDA)
- `product_search` - Product database searches
- `user_action` - User interactions (future)
- `json_extraction` - Malformed JSON recovery attempts (future)
- `session` - Session lifecycle events

## Log Levels

- `debug` - Detailed diagnostic information
- `info` - General informational messages
- `warn` - Warning messages (non-critical issues)
- `error` - Error messages (failures, exceptions)

## Privacy & Security

The logger automatically sanitizes:
- API keys, tokens, passwords
- Email addresses, phone numbers
- Health data details (keeps structure only)
- Any field matching sensitive patterns

Example of sanitized health data:
```json
{
  "event_data": {
    "event_type": "food",
    "has_description": true,
    "has_serving_size": true,
    "fields_present": ["description", "calories", "protein"]
  }
}
```

## Next Steps

1. **Run the migration** in Supabase SQL editor
2. **Test the app** with "citrus element pack" input
3. **Query the logs** to see what Claude actually returned
4. **Analyze the root cause** based on real data
5. **Fix the issue** with confidence (not guessing)

## Future Enhancements (Phase 3 & 4)

- Dashboard for viewing logs in real-time
- Alerting for high error rates
- Log aggregation and trends
- Performance monitoring
- User session replay
