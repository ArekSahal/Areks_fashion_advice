import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { authLinkErrorMessage, isRecoveryLink, parseAuthLink } from './authLink';
import { readRecoveryFlag, startupRecovering, writeRecoveryFlag } from './recoveryFlag';
import { initialWebLink, supabase } from './supabase';

type AuthState = {
  session: Session | null;
  /** True until the stored session (and any pending password reset) has been read on startup. */
  loading: boolean;
  /**
   * True while the user is signed in through a password-reset link and hasn't set a new password yet.
   * The root layout keeps them on the reset screen instead of the tabs. Survives reloads/relaunches.
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

// AsyncStorage is backed by localStorage on web.
const flagStore = AsyncStorage;

/** Holds the Supabase session for the whole app and keeps it in sync with sign-in/out. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(initialWebLink.isRecovery);
  const [linkError, setLinkError] = useState<string | null>(initialWebLink.errorMessage);
  const userIdRef = useRef<string | null>(null);
  const recoveringRef = useRef(recovering);

  const markRecovering = useCallback((userId: string | null, on: boolean) => {
    recoveringRef.current = on;
    setRecovering(on);
    if (userId) void writeRecoveryFlag(flagStore, userId, on);
  }, []);

  useEffect(() => {
    let active = true;

    async function startup() {
      const { data } = await supabase.auth.getSession();
      const current = data.session;
      if (!active) return;
      userIdRef.current = current?.user.id ?? null;
      if (current) {
        const storedFlag = await readRecoveryFlag(flagStore, current.user.id);
        if (!active) return;
        const on = startupRecovering({
          hasSession: true,
          linkIsRecovery: initialWebLink.isRecovery,
          storedFlag,
          alreadyRecovering: recoveringRef.current,
        });
        markRecovering(current.user.id, on);
      } else if (Platform.OS === 'web') {
        // By now Supabase has processed the URL: a reset link that signed nobody in is not a recovery.
        markRecovering(null, false);
      }
      setSession(current);
    }

    startup()
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      const userId = next?.user.id ?? null;
      if (event === 'PASSWORD_RECOVERY') markRecovering(userId, true);
      if (event === 'SIGNED_OUT') markRecovering(userIdRef.current, false);
      userIdRef.current = userId;
      setSession(next);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [markRecovering]);

  // On native, links from auth emails open the app via cloey://; turn them into a session here.
  // The client uses the implicit flow, so the session arrives as tokens in the URL hash.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    async function handle(url: string | null) {
      const link = parseAuthLink(url);
      const error = authLinkErrorMessage(link);
      if (error) {
        setLinkError(error);
        return;
      }
      if (!link.accessToken || !link.refreshToken) return;
      const recovery = isRecoveryLink(link);
      // Mark recovery first so the user never lands in the tabs before setting a password.
      if (recovery) markRecovering(null, true);
      const { data, error: sessionError } = await supabase.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
      if (sessionError || !data.session) {
        if (recovery) markRecovering(null, false);
        setLinkError(authLinkErrorMessage({ ...link, error: 'invalid' }));
        return;
      }
      if (recovery) markRecovering(data.session.user.id, true);
    }

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [markRecovering]);

  const finishRecovery = useCallback(() => markRecovering(userIdRef.current, false), [markRecovering]);
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
