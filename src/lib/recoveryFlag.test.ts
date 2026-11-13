import { describe, expect, it } from 'vitest';
import { readRecoveryFlag, recoveryKey, startupRecovering, writeRecoveryFlag, type KeyValueStore } from './recoveryFlag';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

describe('recovery flag storage', () => {
  it('is stored per user and cleared again', async () => {
    const store = memoryStore();
    await writeRecoveryFlag(store, 'u1', true);
    expect(store.data.get(recoveryKey('u1'))).toBe('1');
    expect(await readRecoveryFlag(store, 'u1')).toBe(true);
    expect(await readRecoveryFlag(store, 'u2')).toBe(false);
    await writeRecoveryFlag(store, 'u1', false);
    expect(await readRecoveryFlag(store, 'u1')).toBe(false);
  });

  it('treats broken storage as "not recovering" instead of crashing', async () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(await readRecoveryFlag(broken, 'u1')).toBe(false);
    await expect(writeRecoveryFlag(broken, 'u1', true)).resolves.toBeUndefined();
  });
});

describe('startupRecovering', () => {
  const base = { hasSession: true, linkIsRecovery: false, storedFlag: false, alreadyRecovering: false };

  it('shows the reset screen when opened from a reset link', () => {
    expect(startupRecovering({ ...base, linkIsRecovery: true })).toBe(true);
  });

  it('stays on the reset screen after a reload (hash gone, flag stored)', async () => {
    const store = memoryStore();
    // First visit: reset link handled, flag stored.
    await writeRecoveryFlag(store, 'u1', true);
    // Reload: URL no longer has the recovery hash, but the session and flag are still there.
    const storedFlag = await readRecoveryFlag(store, 'u1');
    expect(startupRecovering({ ...base, storedFlag })).toBe(true);
  });

  it('lets the user in after the password is saved', async () => {
    const store = memoryStore();
    await writeRecoveryFlag(store, 'u1', true);
    await writeRecoveryFlag(store, 'u1', false); // finishRecovery
    expect(startupRecovering({ ...base, storedFlag: await readRecoveryFlag(store, 'u1') })).toBe(false);
  });

  it('never recovers without a session', () => {
    expect(startupRecovering({ hasSession: false, linkIsRecovery: true, storedFlag: true, alreadyRecovering: true })).toBe(
      false,
    );
  });
});
