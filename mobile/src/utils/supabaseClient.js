import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_KEY'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: null, // We handle auth separately with SecureStore
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
