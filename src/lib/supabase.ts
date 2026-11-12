import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { authLinkErrorMessage, isRecoveryLink, parseAuthLink } from './authLink';
import { readPublicEnv } from './env';

// EXPO_PUBLIC_* values must be referenced statically so Metro inlines them at build time.
const env = readPublicEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

/**
 * What the page URL said on web before Supabase reads and clears the auth hash: whether it was a
 * password-reset link, and the plain-English error if the link failed. Tokens are not kept here.
 */
export const initialWebLink: { isRecovery: boolean; errorMessage: string | null } = (() => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { isRecovery: false, errorMessage: null };
  const link = parseAuthLink(window.location.href);
  const errorMessage = authLinkErrorMessage(link);
  if (errorMessage) {
    // A failed link carries only error text: drop it from the address bar so a reload doesn't repeat it.
    try {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    } catch {
      // Not fatal.
    }
  }
  return { isRecovery: isRecoveryLink(link), errorMessage };
})();

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    // On web, supabase-js uses localStorage by default.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    // supabase-js default, stated so the link handling in auth.tsx (tokens in the URL hash) stays true.
    flowType: 'implicit',
  },
});
