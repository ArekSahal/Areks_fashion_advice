/**
 * Public (publishable) config read from EXPO_PUBLIC_* variables.
 * Never put secret keys here: everything in this file ends up in the app bundle.
 */
export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function readPublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const supabaseUrl = source.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = source.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.',
    );
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)) {
    throw new Error(`EXPO_PUBLIC_SUPABASE_URL does not look like a Supabase URL: ${supabaseUrl}`);
  }
  if (/^sb_secret_/.test(supabaseAnonKey) || /service_role/.test(supabaseAnonKey)) {
    throw new Error('A secret Supabase key was put in the public app config. Use the publishable key.');
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), supabaseAnonKey };
}
