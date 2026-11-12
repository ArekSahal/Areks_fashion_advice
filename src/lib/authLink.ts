/**
 * Pure helpers for links coming back from Supabase Auth emails (sign-up confirmation, password reset).
 * Supabase puts its result in the URL hash (implicit flow: access_token, refresh_token, type) or in the
 * query string (PKCE flow: code), and failures as error / error_code / error_description.
 */

export type AuthLink = {
  type: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  errorCode: string | null;
  error: string | null;
};

function readParams(part: string, into: Map<string, string>) {
  for (const pair of part.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    try {
      into.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue.replace(/\+/g, ' ')));
    } catch {
      // Malformed escape sequence: ignore this pair.
    }
  }
}

export function parseAuthLink(url: string | null | undefined): AuthLink {
  const params = new Map<string, string>();
  if (url) {
    const hashAt = url.indexOf('#');
    const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
    const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
    const queryAt = beforeHash.indexOf('?');
    if (queryAt !== -1) readParams(beforeHash.slice(queryAt + 1), params);
    // Hash values win: that is where Supabase's implicit flow puts the session.
    readParams(hash, params);
  }
  const get = (k: string) => params.get(k) || null;
  return {
    type: get('type'),
    accessToken: get('access_token'),
    refreshToken: get('refresh_token'),
    code: get('code'),
    errorCode: get('error_code'),
    error: get('error') ?? get('error_description'),
  };
}

/** True when the link is a password-reset ("recovery") link that carries a session. */
export function isRecoveryLink(link: AuthLink): boolean {
  return link.type === 'recovery' && !link.error && !link.errorCode;
}

/** Plain-English message for a failed email link, or null when the link has no error. */
export function authLinkErrorMessage(link: AuthLink): string | null {
  if (!link.error && !link.errorCode) return null;
  if (link.errorCode === 'otp_expired') {
    return 'That link has expired or was already used. Request a new one.';
  }
  return 'That link didn’t work. Request a new one.';
}
