import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { authLinkErrorMessage, isRecoveryLink, parseAuthLink } from './authLink';
import { initialWebUrl, supabase } from './supabase';

type AuthState = {
  session: Session | null;
  /** True until the stored session has been read on startup. */
  loading: boolean;
  /**
   * True while the user is signed in through a password-reset link and hasn't set a new password yet.
   * The root layout keeps them on the reset screen instead of the tabs.
   */
  recovering: boolean;
  /** Call after the new password is saved, to let the user into the app. */
  finishRecovery: () => void;
  /** Plain-English message when an email link failed (expired, already used). */
  linkError: string | null;
  clearLinkError: () => void;
};

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  recovering: false,
  finishRecovery: () => {},
  linkError: null,
  clearLinkError: () => {},
});

// On web, Supabase reads the session from the URL itself (detectSessionInUrl); we only need to know
// whether that link was a password reset, and whether it failed.
const initialWebLink = parseAuthLink(initialWebUrl);

/** Holds the Supabase session for the whole app and keeps it in sync with sign-in/out. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(() => isRecoveryLink(initialWebLink));
  const [linkError, setLinkError] = useState<string | null>(() => authLinkErrorMessage(initialWebLink));

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        // Web: by now Supabase has processed the URL. A reset link that didn't produce a session
        // (expired, already used) is not a recovery. (Native links are handled below.)
        if (!data.session && Platform.OS === 'web') setRecovering(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // On native, links from auth emails open the app via cloey://; turn them into a session here.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    async function handle(url: string | null) {
      const link = parseAuthLink(url);
      const error = authLinkErrorMessage(link);
      if (error) {
        setLinkError(error);
        return;
      }
      const recovery = isRecoveryLink(link);
      if (link.accessToken && link.refreshToken) {
        // Mark recovery first so the user never lands in the tabs before setting a password.
        if (recovery) setRecovering(true);
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        });
        if (sessionError) {
          setRecovering(false);
          setLinkError(authLinkErrorMessage({ ...link, error: 'invalid' }));
        }
      } else if (link.code) {
        // PKCE: supabase-js emits PASSWORD_RECOVERY itself for reset links.
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(link.code);
        if (codeError) setLinkError(authLinkErrorMessage({ ...link, error: 'invalid' }));
      }
    }

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  const finishRecovery = useCallback(() => setRecovering(false), []);
  const clearLinkError = useCallback(() => setLinkError(null), []);

  const value = useMemo(
    () => ({ session, loading, recovering, finishRecovery, linkError, clearLinkError }),
    [session, loading, recovering, finishRecovery, linkError, clearLinkError],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
