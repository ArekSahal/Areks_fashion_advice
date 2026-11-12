import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/** Where Supabase sends users back to after they click the link in a confirmation email. */
export function authRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const base = Constants.expoConfig?.experiments?.baseUrl ?? '';
    return `${window.location.origin}${base}/`;
  }
  return Linking.createURL('/');
}
