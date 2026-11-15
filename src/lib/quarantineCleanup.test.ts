// Tests for the cleanup-quarantine Edge Function's selection logic (supabase/functions/_shared/quarantine-cleanup.ts).
import { describe, expect, it } from 'vitest';
import {
  MAX_AGE_MS,
  REMOVE_BATCH_SIZE,
  isFolder,
  joinPath,
  selectExpired,
  toBatches,
} from '../../supabase/functions/_shared/quarantine-cleanup';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('selectExpired', () => {
  it('uses a one-hour default', () => {
    expect(MAX_AGE_MS).toBe(3_600_000);
  });

  it('selects files at least one hour old and keeps younger ones', () => {
    const files = [
      { path: 'u1/a.webp', createdAt: ago(2 * MAX_AGE_MS) },
      { path: 'u1/a.thumb.webp', createdAt: ago(MAX_AGE_MS) }, // exactly 1 h: expired
      { path: 'u1/b.webp', createdAt: ago(MAX_AGE_MS - 1000) }, // 59m59s: kept
      { path: 'u2/c.jpg', createdAt: ago(5 * 60 * 1000) },
    ];
    expect(selectExpired(files, NOW)).toEqual(['u1/a.webp', 'u1/a.thumb.webp']);
  });

  it('keeps files with a missing, invalid or future created_at', () => {
    const files = [
      { path: 'u1/none.webp', createdAt: null },
      { path: 'u1/undef.webp', createdAt: undefined },
      { path: 'u1/bad.webp', createdAt: 'not a date' },
      { path: 'u1/future.webp', createdAt: new Date(NOW.getTime() + 60_000).toISOString() },
    ];
    expect(selectExpired(files, NOW)).toEqual([]);
  });

  it('skips entries without a path', () => {
    expect(selectExpired([{ path: '', createdAt: ago(10 * MAX_AGE_MS) }], NOW)).toEqual([]);
  });

  it('honours a custom max age', () => {
    const files = [{ path: 'u1/a.webp', createdAt: ago(10 * 60 * 1000) }];
    expect(selectExpired(files, NOW, 5 * 60 * 1000)).toEqual(['u1/a.webp']);
    expect(selectExpired(files, NOW, 15 * 60 * 1000)).toEqual([]);
  });
});

describe('toBatches', () => {
  it('splits into batches of 100 by default', () => {
    const paths = Array.from({ length: 250 }, (_, i) => `u/${i}`);
    const batches = toBatches(paths);
    expect(REMOVE_BATCH_SIZE).toBe(100);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(paths);
  });

  it('returns no batches for no paths', () => {
    expect(toBatches([])).toEqual([]);
  });

  it('rejects invalid sizes', () => {
    expect(() => toBatches(['a'], 0)).toThrow(RangeError);
    expect(() => toBatches(['a'], 1.5)).toThrow(RangeError);
  });
});

describe('list helpers', () => {
  it('detects folders and joins paths', () => {
    expect(isFolder({ name: 'u1', id: null })).toBe(true);
    expect(isFolder({ name: 'a.webp', id: 'x', created_at: ago(0) })).toBe(false);
    expect(joinPath('', 'u1')).toBe('u1');
    expect(joinPath('u1', 'a.webp')).toBe('u1/a.webp');
  });
});
