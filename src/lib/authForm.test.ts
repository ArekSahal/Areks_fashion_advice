import { describe, expect, it } from 'vitest';
import {
  friendlyAuthError,
  resetRequestError,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
  validatePassword,
} from './authForm';

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
  it('explains reusing the old password', () => {
    expect(friendlyAuthError({ code: 'same_password' })).toMatch(/haven’t used/);
  });
  it('never leaks raw messages', () => {
    expect(friendlyAuthError({ code: 'x', message: 'pg error 23505 at line 3' })).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('validateNewPassword', () => {
  it('uses the sign-up length rule', () => {
    expect(validateNewPassword('short', 'short').password).toMatch(/8/);
    expect(validateNewPassword('', '').password).toMatch(/Enter/);
  });
  it('requires a matching confirmation', () => {
    expect(validateNewPassword('longenough', '')).toEqual({ password: null, confirm: 'Type the password again.' });
    expect(validateNewPassword('longenough', 'longenougH').confirm).toMatch(/don’t match/);
    expect(validateNewPassword('longenough', 'longenough')).toEqual({ password: null, confirm: null });
  });
});

describe('resetRequestError', () => {
  it('stays neutral for success and account-related errors (no enumeration)', () => {
    expect(resetRequestError(null)).toBe(null);
    expect(resetRequestError({ code: 'user_not_found', status: 404, message: 'User not found' })).toBe(null);
    expect(resetRequestError({ code: 'email_address_invalid', status: 400 })).toBe(null);
  });
  it('shows rate-limit, network and server problems generically', () => {
    expect(resetRequestError({ code: 'over_email_send_rate_limit', status: 429 })).toMatch(/Too many/);
    expect(resetRequestError({ message: 'Failed to fetch', status: 0 })).toMatch(/connection/);
    expect(resetRequestError({ message: 'boom', status: 500 })).toBe('Something went wrong. Please try again.');
  });
});
