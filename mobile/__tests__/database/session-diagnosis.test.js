/**
 * Session Diagnosis Tests
 *
 * These tests diagnose why RLS policies are failing despite having a valid userId.
 * The hypothesis: Supabase client doesn't have the authenticated session set.
 *
 * NOTE: These are diagnostic tests that require a real Supabase connection.
 * They are skipped by default. To run them, use: jest.only() on specific tests.
 */

import { supabase } from '../../src/utils/supabaseClient';
import * as SupabaseAuth from '../../src/utils/supabaseAuth';

describe.skip('Session Diagnosis - Supabase Client Authentication', () => {

  describe('Test Group 1: Session State Verification', () => {

    it('Test 1.1: Verify Supabase client has auth session', async () => {
      // This is the smoking gun test
      const { data: { session }, error } = await supabase.auth.getSession();

      console.log('🔍 DIAGNOSTIC: Supabase client session state');
      console.log('  - Session exists:', session !== null);
      console.log('  - Session user ID:', session?.user?.id);
      console.log('  - Access token exists:', !!session?.access_token);
      console.log('  - Error:', error);

      // If this fails, we found the problem
      expect(session).not.toBeNull();
      if (session) {
        expect(session.user).toBeDefined();
        expect(session.user.id).toBeDefined();
        expect(session.access_token).toBeDefined();
      }
    });

    it('Test 1.2: Compare session sources - SecureStore vs Supabase Client', async () => {
      // Get session from both sources
      const secureStoreSession = await SupabaseAuth.getSession();
      const { data: { session: supabaseClientSession } } = await supabase.auth.getSession();

      console.log('🔍 DIAGNOSTIC: Session source comparison');
      console.log('  - SecureStore session exists:', secureStoreSession !== null);
      console.log('  - SecureStore user ID:', secureStoreSession?.user?.id);
      console.log('  - Supabase client session exists:', supabaseClientSession !== null);
      console.log('  - Supabase client user ID:', supabaseClientSession?.user?.id);
      console.log('  - IDs match:', secureStoreSession?.user?.id === supabaseClientSession?.user?.id);

      // Both should exist and match
      expect(secureStoreSession).not.toBeNull();
      expect(supabaseClientSession).not.toBeNull();

      if (secureStoreSession && supabaseClientSession) {
        expect(secureStoreSession.user.id).toBe(supabaseClientSession.user.id);
      }
    });

    it('Test 1.3: Check auth.uid() in database context', async () => {
      // This tests what RLS policies see
      const { data, error } = await supabase
        .rpc('auth.uid')
        .single();

      console.log('🔍 DIAGNOSTIC: auth.uid() from database perspective');
      console.log('  - auth.uid() value:', data);
      console.log('  - Is null:', data === null);
      console.log('  - Error:', error);

      // If auth.uid() is null, RLS will always fail
      expect(data).not.toBeNull();
    });
  });

  describe('Test Group 2: RLS Policy Verification', () => {

    it('Test 2.1: Test RLS policy directly with simple insert', async () => {
      // Get current user ID
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      console.log('🔍 DIAGNOSTIC: Direct RLS insert test');
      console.log('  - User ID:', userId);

      if (!userId) {
        console.log('  ⚠️  No user ID - skipping insert test');
        expect(userId).toBeDefined();
        return;
      }

      // Try to insert with matching user_id
      const { data, error } = await supabase
        .from('voice_records_audit')
        .insert({
          user_id: userId,
          raw_text: 'RLS diagnosis test',
          record_type: 'test',
          nlp_status: 'pending'
        })
        .select()
        .single();

      console.log('  - Insert succeeded:', !error);
      console.log('  - Error code:', error?.code);
      console.log('  - Error message:', error?.message);
      console.log('  - Inserted record ID:', data?.id);

      // This should succeed if RLS is working
      expect(error).toBeNull();
      expect(data).toBeDefined();

      // Cleanup
      if (data?.id) {
        await supabase.from('voice_records_audit').delete().eq('id', data.id);
      }
    });

    it('Test 2.2: Check current RLS policies', async () => {
      // Query actual RLS policies
      const { data, error } = await supabase
        .from('pg_policies')
        .select('schemaname, tablename, policyname, cmd, qual, with_check')
        .eq('tablename', 'voice_records_audit');

      console.log('🔍 DIAGNOSTIC: RLS policies on voice_records_audit');
      console.log('  - Policies found:', data?.length || 0);

      if (data) {
        data.forEach(policy => {
          console.log(`  - ${policy.policyname}:`);
          console.log(`    - Command: ${policy.cmd}`);
          console.log(`    - Check: ${policy.with_check}`);
        });
      }

      console.log('  - Error:', error);

      // Should have at least one INSERT policy
      const insertPolicy = data?.find(p =>
        p.cmd === 'INSERT' &&
        p.policyname.includes('insert')
      );

      expect(insertPolicy).toBeDefined();
    });

    it('Test 2.3: Test auth.uid() equality check', async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        console.log('🔍 DIAGNOSTIC: No session - cannot test auth.uid() equality');
        expect(userId).toBeDefined();
        return;
      }

      // Use raw SQL to test what RLS sees
      const { data, error } = await supabase
        .from('voice_records_audit')
        .select('count')
        .eq('user_id', userId)
        .limit(0);

      console.log('🔍 DIAGNOSTIC: Can query own records');
      console.log('  - User ID:', userId);
      console.log('  - Query succeeded:', !error);
      console.log('  - Error:', error);

      // Should be able to query without RLS errors
      expect(error).toBeNull();
    });
  });

  describe('Test Group 3: Client Initialization', () => {

    it('Test 3.1: Verify Supabase client configuration', () => {
      console.log('🔍 DIAGNOSTIC: Supabase client configuration');
      console.log('  - Client exists:', !!supabase);
      console.log('  - Auth module exists:', !!supabase.auth);
      console.log('  - Auth methods available:', {
        getSession: typeof supabase.auth.getSession,
        setSession: typeof supabase.auth.setSession,
        getUser: typeof supabase.auth.getUser
      });

      expect(supabase).toBeDefined();
      expect(supabase.auth).toBeDefined();
      expect(supabase.auth.getSession).toBeDefined();
      expect(supabase.auth.setSession).toBeDefined();
    });

    it('Test 3.2: Check if session was ever set on client', async () => {
      // Get session from SecureStore (our manual storage)
      const storedSession = await SupabaseAuth.getSession();

      // Get session from Supabase client
      const { data: { session: clientSession } } = await supabase.auth.getSession();

      console.log('🔍 DIAGNOSTIC: Session synchronization check');
      console.log('  - Stored session exists:', !!storedSession);
      console.log('  - Client session exists:', !!clientSession);
      console.log('  - Sessions match:',
        storedSession?.access_token === clientSession?.access_token
      );

      // THE SMOKING GUN: If stored exists but client doesn't, we found the bug
      if (storedSession && !clientSession) {
        console.log('  🔥 FOUND THE BUG: Session stored but not set on client!');
        console.log('  - This explains the RLS error');
        console.log('  - Fix: Call supabase.auth.setSession() after login');
      }

      // If we have a stored session, client should have it too
      if (storedSession) {
        expect(clientSession).not.toBeNull();
        expect(clientSession?.user?.id).toBe(storedSession?.user?.id);
      }
    });
  });

  describe('Test Group 4: Session Lifecycle', () => {

    it('Test 4.1: Simulate login and verify session propagation', async () => {
      // This tests the complete flow
      const mockSession = {
        access_token: 'mock-token-' + Date.now(),
        refresh_token: 'mock-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: '12345678-1234-1234-1234-123456789012',
          email: 'test@example.com'
        }
      };

      console.log('🔍 DIAGNOSTIC: Session lifecycle test');

      // Step 1: Save session (what happens after OAuth)
      await SupabaseAuth.saveSession(mockSession);
      console.log('  - Step 1: Saved to SecureStore ✓');

      // Step 2: Check if it's in SecureStore
      const storedSession = await SupabaseAuth.getSession();
      console.log('  - Step 2: Retrieved from SecureStore:', !!storedSession);

      // Step 3: Check if Supabase client has it
      const { data: { session: clientSession } } = await supabase.auth.getSession();
      console.log('  - Step 3: Supabase client has session:', !!clientSession);

      // THE KEY QUESTION: Does saving to SecureStore automatically set on client?
      if (storedSession && !clientSession) {
        console.log('  🔥 FOUND THE BUG: saveSession() does NOT set on Supabase client');
        console.log('  - Need to call: await supabase.auth.setSession(session)');
      }

      expect(storedSession).not.toBeNull();
    });
  });

  describe('Smoking Gun Test', () => {

    it('THE DEFINITIVE TEST: Session state right before createAuditRecord', async () => {
      console.log('🔍 🔥 DEFINITIVE DIAGNOSTIC 🔥');

      // Simulate exactly what happens in home.jsx
      const { data: user } = { data: null }; // useUser() might return null

      // Get userId from our helper (this works)
      const storedSession = await SupabaseAuth.getSession();
      const userId = storedSession?.user?.id || '3597587c-1242-4c31-ac21-ce2768e6fbd8';

      // Get session from Supabase client (what RLS uses)
      const { data: { session: clientSession } } = await supabase.auth.getSession();

      console.log('\n=== BEFORE DATABASE CALL ===');
      console.log('userId (from our code):', userId);
      console.log('clientSession exists:', !!clientSession);
      console.log('clientSession.user.id:', clientSession?.user?.id);
      console.log('auth.uid() will be:', clientSession?.user?.id || 'NULL');
      console.log('\n=== RLS CHECK ===');
      console.log('RLS checks: auth.uid() = user_id');
      console.log('  Left side (auth.uid()):', clientSession?.user?.id || 'NULL');
      console.log('  Right side (user_id):', userId);
      console.log('  Match:', (clientSession?.user?.id || null) === userId);

      if (!clientSession) {
        console.log('\n🔥 ROOT CAUSE CONFIRMED:');
        console.log('  - Supabase client has NO session');
        console.log('  - auth.uid() returns NULL');
        console.log('  - RLS check: NULL = userId → FALSE');
        console.log('  - Result: RLS violation error');
        console.log('\n💡 SOLUTION:');
        console.log('  After login, call: await supabase.auth.setSession(session)');
      }

      // The assertion that should fail if hypothesis is correct
      expect(clientSession).not.toBeNull();
      expect(clientSession?.user?.id).toBe(userId);
    });
  });
});
