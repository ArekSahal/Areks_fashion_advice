import { describe, expect, it } from 'vitest';
import { authLinkErrorMessage, isRecoveryLink, parseAuthLink } from './authLink';

describe('parseAuthLink', () => {
  it('reads an implicit-flow recovery link from the hash (web)', () => {
    const link = parseAuthLink(
      'https://areksahal.github.io/Areks_fashion_advice/#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery',
    );
    expect(link).toMatchObject({ type: 'recovery', accessToken: 'abc', refreshToken: 'def', code: null });
    expect(isRecoveryLink(link)).toBe(true);
    expect(authLinkErrorMessage(link)).toBe(null);
  });

  it('reads a native deep link', () => {
    const link = parseAuthLink('cloey://#access_token=a%2Bb&refresh_token=r&type=recovery');
    expect(link.accessToken).toBe('a+b');
    expect(isRecoveryLink(link)).toBe(true);
  });

  it('reads a PKCE code from the query string', () => {
    const link = parseAuthLink('cloey://?code=xyz');
    expect(link.code).toBe('xyz');
    expect(isRecoveryLink(link)).toBe(false);
  });

  it('treats sign-up confirmation links as not recovery', () => {
    expect(isRecoveryLink(parseAuthLink('https://x.test/#access_token=a&refresh_token=b&type=signup'))).toBe(false);
  });

  it('handles plain URLs, empty input and malformed escapes', () => {
    expect(parseAuthLink('https://x.test/').type).toBe(null);
    expect(parseAuthLink(null).accessToken).toBe(null);
    expect(parseAuthLink('https://x.test/#%E0%A4%A=1&type=recovery').type).toBe('recovery');
  });
});

describe('authLinkErrorMessage', () => {
  it('explains expired links in plain English', () => {
    const link = parseAuthLink(
      'https://x.test/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(isRecoveryLink(link)).toBe(false);
    expect(authLinkErrorMessage(link)).toMatch(/expired/);
    expect(authLinkErrorMessage(link)).not.toMatch(/otp/);
  });
  it('gives a generic message for other errors', () => {
    expect(authLinkErrorMessage(parseAuthLink('cloey://?error=server_error'))).toMatch(/didn’t work/);
  });
});
