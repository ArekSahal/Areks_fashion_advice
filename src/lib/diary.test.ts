import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny chainable stand-in for supabase-js: records every call and answers awaited queries from a queue per table.
type Result = { data?: unknown; error?: unknown };
const calls: { table: string; method: string; args: unknown[] }[] = [];
const answers: Record<string, Result[]> = {};

function from(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'single']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => void) => resolve(answers[table]?.shift() ?? { data: null, error: null });
  return chain;
}

vi.mock('./supabase', () => ({ supabase: { from } }));

const diary = await import('./diary');
const {
  addDays,
  attachItems,
  canSaveOutfit,
  createOutfit,
  dayLabel,
  diaryErrorKind,
  groupByDay,
  itemDiff,
  listEntriesBetween,
  listEntriesSince,
  localDateString,
  outfitInsert,
  outfitItemRows,
  PartialOutfitError,
  partialOutfitId,
  photoLabel,
  pieceLabel,
  saveLabel,
  shortDate,
  toggleItem,
  updateOutfit,
} = diary;

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

describe('localDateString', () => {
  it('uses the local calendar day, not UTC', () => {
    // 00:30 local time on 1 Dec. In Stockholm, UTC would still be 30 Nov.
    expect(localDateString(new Date(2026, 11, 1, 0, 30))).toBe('2026-12-01');
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('addDays / dayLabel', () => {
  it('steps over month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-11-23', -13)).toBe('2026-11-10');
  });

  it('reads naturally', () => {
    expect(dayLabel('2026-11-23', '2026-11-23')).toBe('Today');
    expect(dayLabel('2026-11-22', '2026-11-23')).toBe('Yesterday');
    expect(dayLabel('2026-11-20', '2026-11-23')).toBe('Fri 20 Nov');
    expect(shortDate('2026-11-23')).toBe('Mon 23 Nov');
  });
});

describe('selection', () => {
  it('adds in tap order and removes on a second tap', () => {
    let s = toggleItem([], 'a');
    s = toggleItem(s, 'b');
    expect(s).toEqual(['a', 'b']);
    expect(toggleItem(s, 'a')).toEqual(['b']);
  });

  it('stops adding at the cap but still allows removing', () => {
    const full = ['a', 'b'];
    expect(toggleItem(full, 'c', 2)).toEqual(['a', 'b']);
    expect(toggleItem(full, 'b', 2)).toEqual(['a']);
  });

  it('needs at least one item or a photo', () => {
    expect(canSaveOutfit([], null)).toBe(false);
    expect(canSaveOutfit(['a'], null)).toBe(true);
    expect(canSaveOutfit([], 'p')).toBe(true);
  });

  it('labels the save button with the count', () => {
    expect(saveLabel(0, false)).toBe('Save outfit');
    expect(saveLabel(1, false)).toBe('Save outfit · 1 item');
    expect(saveLabel(3, true)).toBe('Save changes · 3 items');
  });
});

describe('pieceLabel', () => {
  it('names confirmed items and never shows unconfirmed AI suggestions', () => {
    expect(pieceLabel({ tags_confirmed_at: 'x', category: 'bottoms', subcategory: 'wide_leg_trousers' })).toBe('Wide leg trousers');
    expect(pieceLabel({ tags_confirmed_at: 'x', category: 'shoes', subcategory: null })).toBe('Shoes');
    expect(pieceLabel({ tags_confirmed_at: null, category: 'shoes', subcategory: 'sneakers' })).toBeUndefined();
  });
});

describe('photoLabel', () => {
  it('gives every photo a distinct name with its local day', () => {
    expect(photoLabel(1, 5, new Date(2026, 10, 23, 9).toISOString())).toBe('Outfit photo 2 of 5, added Mon 23 Nov');
    expect(photoLabel(0, 1, 'not a date')).toBe('Outfit photo 1 of 1');
  });
});

describe('payloads', () => {
  it('only writes the client-writable outfit columns', () => {
    expect(outfitInsert('2026-11-23', null)).toEqual({ worn_on: '2026-11-23', photo_id: null });
    expect(Object.keys(outfitInsert('2026-11-23', 'p')).sort()).toEqual(['photo_id', 'worn_on']);
  });

  it('builds one link per item, without owner_id or duplicates', () => {
    expect(outfitItemRows('o', ['a', 'b', 'a'])).toEqual([
      { outfit_id: 'o', item_id: 'a' },
      { outfit_id: 'o', item_id: 'b' },
    ]);
  });

  it('diffs items for an edit', () => {
    expect(itemDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
    expect(itemDiff(['a'], ['a'])).toEqual({ add: [], remove: [] });
  });
});

describe('diaryErrorKind', () => {
  it('maps database errors to messages the screen can explain', () => {
    expect(diaryErrorKind({ code: '23503' })).toBe('stale');
    expect(diaryErrorKind({ code: '23514' })).toBe('date');
    expect(diaryErrorKind({ code: '42501' })).toBe('auth');
    expect(diaryErrorKind({ code: '23505' })).toBe('stale');
    expect(diaryErrorKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(diaryErrorKind(null)).toBe('network');
  });
});

describe('grouping', () => {
  const base = { photo_id: null };
  it('attaches items and groups by day, newest day first', () => {
    const entries = attachItems(
      [
        { ...base, id: 'o2', worn_on: '2026-11-23', created_at: '2026-11-23T18:00:00Z' },
        { ...base, id: 'o1', worn_on: '2026-11-23', created_at: '2026-11-23T08:00:00Z' },
        { ...base, id: 'o0', worn_on: '2026-11-21', created_at: '2026-11-21T08:00:00Z' },
      ],
      [
        { outfit_id: 'o1', item_id: 'a' },
        { outfit_id: 'o1', item_id: 'b' },
        { outfit_id: 'o0', item_id: 'c' },
      ],
    );
    const days = groupByDay(entries);
    expect(days.map((d) => d.day)).toEqual(['2026-11-23', '2026-11-21']);
    expect(days[0]?.entries.map((e) => [e.id, e.item_ids])).toEqual([
      ['o1', ['a', 'b']],
      ['o2', []],
    ]);
  });
});

describe('listEntriesSince / listEntriesBetween', () => {
  const outfit = { id: 'o1', worn_on: '2026-11-24', photo_id: null, created_at: '2026-11-24T08:00:00Z' };

  it('reads from a day on, with no upper bound', async () => {
    answers.outfits = [{ data: [outfit], error: null }];
    answers.outfit_items = [{ data: [{ outfit_id: 'o1', item_id: 'a' }], error: null }];
    await expect(listEntriesSince('2026-11-13')).resolves.toEqual([{ ...outfit, item_ids: ['a'] }]);
    expect(calls).toContainEqual({ table: 'outfits', method: 'gte', args: ['worn_on', '2026-11-13'] });
    expect(calls.some((c) => c.method === 'lte')).toBe(false);
    expect(calls).toContainEqual({ table: 'outfit_items', method: 'in', args: ['outfit_id', ['o1']] });
  });

  it('reads a closed range of days, both ends included, newest day first', async () => {
    answers.outfits = [{ data: [outfit], error: null }];
    answers.outfit_items = [{ data: [], error: null }];
    await expect(listEntriesBetween('2026-11-01', '2026-11-30')).resolves.toEqual([{ ...outfit, item_ids: [] }]);
    const outfitCalls = calls.filter((c) => c.table === 'outfits').map((c) => [c.method, ...c.args]);
    expect(outfitCalls).toEqual([
      ['select', 'id, worn_on, photo_id, created_at'],
      ['gte', 'worn_on', '2026-11-01'],
      ['lte', 'worn_on', '2026-11-30'],
      ['order', 'worn_on', { ascending: false }],
      ['order', 'created_at', { ascending: true }],
      ['limit', 100],
    ]);
  });

  it('skips the links query for an empty month and throws read errors', async () => {
    answers.outfits = [{ data: [], error: null }];
    await expect(listEntriesBetween('2026-10-01', '2026-10-31')).resolves.toEqual([]);
    expect(calls.some((c) => c.table === 'outfit_items')).toBe(false);
    const readError = { message: 'offline' };
    answers.outfits = [{ data: null, error: readError }];
    await expect(listEntriesBetween('2026-10-01', '2026-10-31')).rejects.toBe(readError);
  });
});

describe('createOutfit', () => {
  it('inserts the entry, reads its id back and links the items', async () => {
    answers.outfits = [{ data: { id: 'new' }, error: null }];
    answers.outfit_items = [{ data: null, error: null }];
    await expect(createOutfit('2026-11-23', ['a', 'b'], 'p')).resolves.toBe('new');
    const inserts = calls.filter((c) => c.method === 'insert');
    expect(inserts).toEqual([
      { table: 'outfits', method: 'insert', args: [{ worn_on: '2026-11-23', photo_id: 'p' }] },
      {
        table: 'outfit_items',
        method: 'insert',
        args: [
          [
            { outfit_id: 'new', item_id: 'a' },
            { outfit_id: 'new', item_id: 'b' },
          ],
        ],
      },
    ]);
  });

  it('removes the half-made entry when linking fails, and rethrows', async () => {
    const fkError = { code: '23503', message: 'fk' };
    answers.outfits = [{ data: { id: 'new' }, error: null }, { data: null, error: null }];
    answers.outfit_items = [{ data: null, error: fkError }];
    await expect(createOutfit('2026-11-23', ['gone'], null)).rejects.toBe(fkError);
    expect(calls.some((c) => c.table === 'outfits' && c.method === 'delete')).toBe(true);
    expect(calls).toContainEqual({ table: 'outfits', method: 'eq', args: ['id', 'new'] });
  });

  it('hands back the saved entry id when linking and the rollback both fail', async () => {
    const fkError = { code: '23503', message: 'fk' };
    answers.outfits = [{ data: { id: 'new' }, error: null }, { data: null, error: { message: 'offline' } }];
    answers.outfit_items = [{ data: null, error: fkError }];
    const err = await createOutfit('2026-11-23', ['gone'], null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PartialOutfitError);
    expect(partialOutfitId(err)).toBe('new');
    expect(partialOutfitId(fkError)).toBeNull();
    expect(diaryErrorKind(err)).toBe('stale');
  });

  it('throws the insert error without linking anything', async () => {
    const dateError = { code: '23514' };
    answers.outfits = [{ data: null, error: dateError }];
    await expect(createOutfit('2099-01-01', ['a'], null)).rejects.toBe(dateError);
    expect(calls.some((c) => c.table === 'outfit_items')).toBe(false);
  });
});

describe('updateOutfit', () => {
  it('only touches what changed', async () => {
    answers.outfit_items = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    await updateOutfit({ id: 'o', photo_id: null, item_ids: ['a', 'b'] }, ['b', 'c'], null);
    expect(calls.some((c) => c.table === 'outfits')).toBe(false);
    expect(calls).toContainEqual({ table: 'outfit_items', method: 'eq', args: ['outfit_id', 'o'] });
    expect(calls).toContainEqual({ table: 'outfit_items', method: 'in', args: ['item_id', ['a']] });
    expect(calls).toContainEqual({
      table: 'outfit_items',
      method: 'upsert',
      args: [[{ outfit_id: 'o', item_id: 'c' }], { onConflict: 'outfit_id,item_id', ignoreDuplicates: true }],
    });
    expect(calls.some((c) => c.method === 'insert')).toBe(false);
  });

  it('can repeat a half-finished save: links that already exist are skipped, not an error', async () => {
    // First attempt linked 'c' but the reply was lost, so the screen still thinks the entry has only 'a'.
    answers.outfit_items = [{ data: null, error: null }];
    await expect(updateOutfit({ id: 'o', photo_id: null, item_ids: ['a'] }, ['a', 'c'], null)).resolves.toBeUndefined();
    const upsert = calls.find((c) => c.method === 'upsert');
    expect(upsert?.args[1]).toEqual({ onConflict: 'outfit_id,item_id', ignoreDuplicates: true });
  });

  it('updates the photo and reports a vanished entry as stale', async () => {
    answers.outfits = [{ data: [], error: null }];
    const err = await updateOutfit({ id: 'o', photo_id: null, item_ids: [] }, [], 'p').catch((e: unknown) => e);
    expect(calls).toContainEqual({ table: 'outfits', method: 'update', args: [{ photo_id: 'p' }] });
    expect(diaryErrorKind(err)).toBe('stale');
  });
});
