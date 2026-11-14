// Pure selection logic for the cleanup-quarantine Edge Function (issue #27): which uploads-quarantine files are old
// enough to delete, and how to batch the Storage API remove() calls. No imports and no Deno or Node globals, so
// Vitest can test it from src/lib/quarantineCleanup.test.ts.

/** Files younger than this may still be on their way to process-image, so they are never touched. */
export const MAX_AGE_MS = 60 * 60 * 1000;

/** Paths per Storage API remove() call. */
export const REMOVE_BATCH_SIZE = 100;

export type QuarantineFile = { path: string; createdAt: string | null | undefined };

/** A Storage API list() entry. Folders have id === null and no created_at. */
export type StorageListEntry = { name: string; id: string | null; created_at?: string | null };

export function isFolder(entry: StorageListEntry): boolean {
  return entry.id === null;
}

export function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

/**
 * Paths of files created at least maxAgeMs before now. Files without a valid created_at, or dated in the future,
 * are kept: when in doubt we leave a file for the next run rather than delete an upload that may be in progress.
 */
export function selectExpired(files: QuarantineFile[], now: Date, maxAgeMs: number = MAX_AGE_MS): string[] {
  const cutoff = now.getTime() - maxAgeMs;
  const out: string[] = [];
  for (const f of files) {
    if (!f.path || !f.createdAt) continue;
    const t = Date.parse(f.createdAt);
    if (Number.isNaN(t)) continue;
    if (t <= cutoff) out.push(f.path);
  }
  return out;
}

export function toBatches<T>(items: T[], size: number = REMOVE_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('batch size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
