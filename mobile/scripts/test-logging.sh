#!/bin/bash

# Test Logging Infrastructure
# This script runs logging tests and verifies database state

set -e

echo "🧪 Testing Logging Infrastructure"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Run unit tests
echo "📝 Step 1: Running unit tests..."
npm test -- __tests__/logging/logging-integration.test.js

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} Unit tests passed"
else
  echo -e "${RED}✗${NC} Unit tests failed"
  exit 1
fi

echo ""

# Step 2: Check if app_logs table exists (requires SUPABASE_URL and SUPABASE_KEY)
echo "📊 Step 2: Checking database setup..."

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
  echo -e "${YELLOW}⚠${NC}  Skipping database check (SUPABASE_URL or SUPABASE_KEY not set)"
  echo "   To test with real database, set environment variables:"
  echo "   export SUPABASE_URL=https://your-project.supabase.co"
  echo "   export SUPABASE_KEY=your-anon-key"
else
  echo "   Supabase URL: $SUPABASE_URL"

  # Check if table exists using Supabase REST API
  response=$(curl -s -w "%{http_code}" -o /tmp/supabase_check.json \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    "$SUPABASE_URL/rest/v1/app_logs?select=id&limit=1")

  if [ "$response" = "200" ]; then
    echo -e "${GREEN}✓${NC} app_logs table exists"
  else
    echo -e "${RED}✗${NC} app_logs table not found (HTTP $response)"
    echo "   Run the migration: mobile/supabase_migrations/001_create_app_logs_table.sql"
    exit 1
  fi
fi

echo ""

# Step 3: Summary
echo "📋 Test Summary"
echo "==============="
echo -e "${GREEN}✓${NC} Unit tests passed"

if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_KEY" ]; then
  echo -e "${GREEN}✓${NC} Database connection verified"
  echo ""
  echo "🎉 All logging tests passed!"
  echo ""
  echo "Next steps:"
  echo "1. Test in app: Sign in and perform voice input"
  echo "2. Check logs: SELECT * FROM app_logs ORDER BY created_at DESC LIMIT 10;"
  echo "3. Verify user_id is populated in all logs"
else
  echo -e "${YELLOW}⚠${NC}  Database tests skipped (no credentials)"
  echo ""
  echo "✅ Unit tests passed!"
  echo ""
  echo "To run full integration tests:"
  echo "1. Set SUPABASE_URL and SUPABASE_KEY environment variables"
  echo "2. Run this script again"
fi

echo ""
