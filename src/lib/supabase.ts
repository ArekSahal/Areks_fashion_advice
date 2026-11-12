import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { readPublicEnv } from './env';

// EXPO_PUBLIC_* values must be referenced statically so Metro inlines them at build time.
const env = readPublicEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

/**
 * The page URL on web as it was before Supabase reads and clears the auth hash from it.
 * Used to tell a password-reset link apart from a normal sign-in.
 */
export const initialWebUrl: string | null =
  Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null;

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    // On web, supabase-js uses localStorage by default.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
