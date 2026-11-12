/** Pure helpers for the sign-in / sign-up forms (unit-tested; no React or Supabase here). */

export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(email: string): string | null {
  const e = email.trim();
  if (!e) return 'Enter your email.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'That doesn’t look like an email address.';
  return null;
}

export function validatePassword(password: string, mode: 'sign-in' | 'sign-up'): string | null {
  if (!password) return 'Enter your password.';
  if (mode === 'sign-up' && password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function validateDisplayName(name: string): string | null {
  if (name.trim().length > 60) return 'Keep it under 60 characters.';
  return null;
}

/**
 * Turns Supabase Auth errors into plain-English messages (design-system rule: no raw error codes).
 * Matches on `code` first, then on message text for older error shapes.
 */
export function friendlyAuthError(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Wrong email or password.';
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Please confirm your email first. Check your inbox for the link.';
  }
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) {
    return 'There’s already an account with this email. Try signing in.';
  }
  if (code === 'weak_password' || msg.includes('password should')) {
    return 'That password is too weak. Try a longer one.';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error.status === 429) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (code === 'email_address_invalid' || msg.includes('invalid format')) {
    return 'That email address can’t be used. Check it and try again.';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Can’t reach Cloey right now. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
