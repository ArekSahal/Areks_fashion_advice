import { describe, expect, it } from 'vitest';
import { readPublicEnv } from './env';

const url = 'https://emnkjfoccluygilkebbz.supabase.co';
const key = 'sb_publishable_abc';

describe('readPublicEnv', () => {
  it('reads valid values and strips a trailing slash', () => {
    expect(
      readPublicEnv({ EXPO_PUBLIC_SUPABASE_URL: `${url}/`, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }),
    ).toEqual({ supabaseUrl: url, supabaseAnonKey: key });
  });

  it('throws when values are missing', () => {
    expect(() => readPublicEnv({})).toThrow(/Missing/);
  });

  it('rejects non-Supabase URLs', () => {
    expect(() =>
      readPublicEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://evil.example.com', EXPO_PUBLIC_SUPABASE_ANON_KEY: key }),
    ).toThrow(/Supabase URL/);
  });

  it('refuses secret keys in the public bundle', () => {
    expect(() =>
      readPublicEnv({ EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_xyz' }),
    ).toThrow(/secret/);
  });
});
