import { describe, expect, it } from 'vitest';
import { friendlyAuthError, validateDisplayName, validateEmail, validatePassword } from './authForm';

describe('validateEmail', () => {
  it('accepts normal addresses, trimming spaces', () => {
    expect(validateEmail(' anna@example.se ')).toBe(null);
  });
  it('rejects empty and malformed addresses', () => {
    expect(validateEmail('')).toMatch(/Enter/);
    expect(validateEmail('anna@')).toMatch(/doesn’t look/);
    expect(validateEmail('anna example.se')).toMatch(/doesn’t look/);
  });
});

describe('validatePassword', () => {
  it('requires 8+ characters only when signing up', () => {
    expect(validatePassword('short', 'sign-up')).toMatch(/8/);
    expect(validatePassword('short', 'sign-in')).toBe(null);
    expect(validatePassword('longenough', 'sign-up')).toBe(null);
  });
  it('requires a password', () => {
    expect(validatePassword('', 'sign-in')).toMatch(/Enter/);
  });
});

describe('validateDisplayName', () => {
  it('limits length to 60', () => {
    expect(validateDisplayName('a'.repeat(61))).toMatch(/60/);
    expect(validateDisplayName('Arek')).toBe(null);
  });
});

describe('friendlyAuthError', () => {
  it('maps known codes to plain English', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Wrong email or password.');
    expect(friendlyAuthError({ message: 'Email not confirmed' })).toMatch(/confirm your email/);
    expect(friendlyAuthError({ code: 'user_already_exists' })).toMatch(/already an account/);
    expect(friendlyAuthError({ status: 429 })).toMatch(/Too many/);
  });
  it('never leaks raw messages', () => {
    expect(friendlyAuthError({ code: 'x', message: 'pg error 23505 at line 3' })).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
