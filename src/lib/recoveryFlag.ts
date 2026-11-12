/**
 * Remembers "this user opened a password-reset link and hasn't set a new password yet" across reloads
 * (web) and relaunches (native), so a reload can't skip the reset screen. Pure logic; storage is passed in.
 */

/** The subset of AsyncStorage / localStorage we use. */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};

export function recoveryKey(userId: string): string {
  return `cloey.recovery.${userId}`;
}

export async function readRecoveryFlag(store: KeyValueStore, userId: string): Promise<boolean> {
  try {
    return (await store.getItem(recoveryKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function writeRecoveryFlag(store: KeyValueStore, userId: string, on: boolean): Promise<void> {
  try {
    if (on) await store.setItem(recoveryKey(userId), '1');
    else await store.removeItem(recoveryKey(userId));
  } catch {
    // Storage unavailable (private mode etc.): the in-memory flag still protects this visit.
  }
}

/**
 * Whether to show the reset screen once the stored session has been read at startup.
 * - No session: never (an expired or used link signs nobody in).
 * - Otherwise: if the page was opened from a reset link, if the flag was stored on an earlier visit,
 *   or if a reset link was already handled in this run.
 */
export function startupRecovering(input: {
  hasSession: boolean;
  linkIsRecovery: boolean;
  storedFlag: boolean;
  alreadyRecovering: boolean;
}): boolean {
  if (!input.hasSession) return false;
  return input.linkIsRecovery || input.storedFlag || input.alreadyRecovering;
}
