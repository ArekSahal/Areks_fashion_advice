import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny chainable stand-in for supabase-js: records every call and answers awaited queries from a queue per table.
type Result = { data?: unknown; error?: unknown };
const calls: { table: string; method: string; args: unknown[] }[] = [];
const answers: Record<string, Result[]> = {};

function from(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => void) => resolve(answers[table]?.shift() ?? { data: null, error: null });
  return chain;
}

vi.mock('./supabase', () => ({ supabase: { from } }));

const { getItemWearStats, NOT_WORN, wearCountText, wearStatsFromRow, wearSummary } = await import('./wearStats');

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

describe('wearCountText', () => {
  it('reads naturally for 0, 1 and more', () => {
    expect(wearCountText(0)).toBe('Not worn yet');
    expect(wearCountText(1)).toBe('Worn once');
    expect(wearCountText(2)).toBe('Worn 2 times');
    expect(wearCountText(12)).toBe('Worn 12 times');
  });

  it('treats nonsense as never worn', () => {
    expect(wearCountText(-1)).toBe('Not worn yet');
    expect(wearCountText(Number.NaN)).toBe('Not worn yet');
  });
});

describe('wearSummary', () => {
  const today = '2026-11-23';

  it('says when it was last worn', () => {
    expect(wearSummary({ wear_count: 3, last_worn_on: '2026-11-22' }, today)).toBe('Worn 3 times · last worn yesterday');
    expect(wearSummary({ wear_count: 1, last_worn_on: today }, today)).toBe('Worn once · last worn today');
    expect(wearSummary({ wear_count: 5, last_worn_on: '2026-11-20' }, today)).toBe('Worn 5 times · last worn Fri 20 Nov');
  });

  it('handles never worn and a missing date', () => {
    expect(wearSummary(NOT_WORN, today)).toBe('Not worn yet');
    expect(wearSummary({ wear_count: 0, last_worn_on: '2026-11-22' }, today)).toBe('Not worn yet');
    expect(wearSummary({ wear_count: 2, last_worn_on: null }, today)).toBe('Worn 2 times');
  });
});

describe('wearStatsFromRow', () => {
  it('reads a view row', () => {
    expect(wearStatsFromRow({ item_id: 'a', wear_count: 4, last_worn_on: '2026-11-01' })).toEqual({
      wear_count: 4,
      last_worn_on: '2026-11-01',
    });
  });

  it('turns a missing or odd row into never worn', () => {
    expect(wearStatsFromRow(null)).toEqual(NOT_WORN);
    expect(wearStatsFromRow(undefined)).toEqual(NOT_WORN);
    expect(wearStatsFromRow({ wear_count: 0, last_worn_on: null })).toEqual(NOT_WORN);
    expect(wearStatsFromRow({ wear_count: 'x', last_worn_on: '2026-11-01' })).toEqual(NOT_WORN);
    expect(wearStatsFromRow({ wear_count: 2, last_worn_on: 'yesterday' })).toEqual({ wear_count: 2, last_worn_on: null });
  });

  it('does not share the NOT_WORN object', () => {
    const s = wearStatsFromRow(null);
    s.wear_count = 9;
    expect(NOT_WORN.wear_count).toBe(0);
  });
});

describe('getItemWearStats', () => {
  it('reads one row from item_wear_stats for the item', async () => {
    answers.item_wear_stats = [{ data: { item_id: 'i1', wear_count: 2, last_worn_on: '2026-11-20' }, error: null }];
    await expect(getItemWearStats('i1')).resolves.toEqual({ wear_count: 2, last_worn_on: '2026-11-20' });
    expect(calls.every((c) => c.table === 'item_wear_stats')).toBe(true);
    expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['item_id', 'i1']);
    expect(calls.some((c) => c.method === 'maybeSingle')).toBe(true);
  });

  it('reads no row as never worn', async () => {
    answers.item_wear_stats = [{ data: null, error: null }];
    await expect(getItemWearStats('gone')).resolves.toEqual(NOT_WORN);
  });

  it('throws the query error', async () => {
    const err = { code: 'PGRST301', message: 'JWT expired' };
    answers.item_wear_stats = [{ data: null, error: err }];
    await expect(getItemWearStats('i1')).rejects.toBe(err);
  });
});
