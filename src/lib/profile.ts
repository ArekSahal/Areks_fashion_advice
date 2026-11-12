import { supabase } from './supabase';

export type ShoppingPreference = 'menswear' | 'womenswear' | 'both';

export type Profile = {
  id: string;
  display_name: string | null;
  shopping_preference: ShoppingPreference | null;
  consent_face_analysis: boolean;
  consent_face_analysis_at: string | null;
  style_unlocked_at: string | null;
  created_at: string;
};

/** Fields the user may change (matches the column grants in the profiles migration). */
export type ProfileUpdate = Partial<Pick<Profile, 'display_name' | 'shopping_preference' | 'consent_face_analysis'>>;

const COLUMNS =
  'id, display_name, shopping_preference, consent_face_analysis, consent_face_analysis_at, style_unlocked_at, created_at';

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', userId).single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').update(update).eq('id', userId).select(COLUMNS).single();
  if (error) throw error;
  return data as Profile;
}

/** Calls an account Edge Function with the user's session (supabase-js adds the auth header). */
export async function invokeAccountFunction<T>(name: 'account-export' | 'account-delete', body?: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });
  if (error) throw error;
  if (data === null) throw new Error('Empty response');
  return data;
}
