import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/**
 * Where Supabase sends users back to after they click the link in a confirmation or password-reset email.
 * Always the app's start page (already in supabase/config.toml `additional_redirect_urls`); the auth
 * listener in `auth.tsx` decides which screen to show.
 */
export function authRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const base = Constants.expoConfig?.experiments?.baseUrl ?? '';
    return `${window.location.origin}${base}/`;
  }
  return Linking.createURL('/');
}
