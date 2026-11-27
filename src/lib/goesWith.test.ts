import { describe, expect, it } from 'vitest';
import { GROUP_TITLES, goesWithFor, toMatchItem, type GoesWithRow } from './goesWith';
import { CATEGORIES } from './taxonomy';

let n = 0;
const row = (p: Partial<GoesWithRow> & { subcategory: string | null }): GoesWithRow => ({
  id: p.id ?? `r${++n}`,
  colours: [],
  pattern: 'solid',
  materials: [],
  formality: 3,
  seasons: [],
  status: 'owned',
  tags_confirmed_at: '2026-11-01T00:00:00Z',
  ...p,
});

const navyKnit = row({ id: 'seed', subcategory: 'knit', colours: ['navy'], materials: ['wool'], formality: 3 });
const greyTrousers = row({ subcategory: 'trousers', colours: ['grey'], materials: ['wool'], formality: 3 });
const beigeChinos = row({ subcategory: 'chinos', colours: ['beige'], materials: ['cotton'], formality: 3 });
const whiteSneakers = row({ subcategory: 'sneakers', colours: ['white'], materials: ['leather'], formality: 2 });
const brownLoafers = row({ subcategory: 'loafers', colours: ['brown'], materials: ['leather'], formality: 3 });
const camelCoat = row({ subcategory: 'coat', colours: ['camel'], materials: ['wool'], formality: 4 });

describe('toMatchItem', () => {
  it('maps a tagged row', () => {
    expect(toMatchItem(navyKnit)).toEqual({
      id: 'seed',
      subcategory: 'knit',
      colours: ['navy'],
      pattern: 'solid',
      materials: ['wool'],
      formality: 3,
      seasons: [],
      status: 'owned',
      tags_confirmed_at: '2026-11-01T00:00:00Z',
    });
  });

  it('returns null without a known garment type', () => {
    expect(toMatchItem(row({ subcategory: null }))).toBeNull();
    expect(toMatchItem(row({ subcategory: 'spacesuit' }))).toBeNull();
  });

  it('drops values outside the taxonomy instead of failing', () => {
    const m = toMatchItem(
      row({ subcategory: 'shirt', colours: ['navy', 'ultraviolet'], pattern: 'tartan-ish', materials: ['wool', 'mithril'], formality: 9, seasons: ['monsoon', 'summer'], status: 'lost' }),
    );
    expect(m).toMatchObject({ colours: ['navy'], pattern: null, materials: ['wool'], formality: null, seasons: ['summer'], status: null });
  });

  it('treats null arrays as empty', () => {
    const m = toMatchItem(row({ subcategory: 'shirt', colours: null, materials: null, seasons: null, formality: null }));
    expect(m).toMatchObject({ colours: [], materials: [], seasons: [], formality: null });
  });
});

describe('goesWithFor', () => {
  const wardrobe = [navyKnit, greyTrousers, beigeChinos, whiteSneakers, brownLoafers, camelCoat];

  it('reports a missing, untyped or inactive seed', () => {
    expect(goesWithFor('nope', wardrobe)).toEqual({ kind: 'not_found' });
    expect(goesWithFor('u', [row({ id: 'u', subcategory: null }), greyTrousers])).toEqual({ kind: 'needs_tags' });
    expect(goesWithFor('s', [row({ id: 's', subcategory: 'knit', status: 'sold' }), greyTrousers])).toEqual({ kind: 'inactive' });
    expect(goesWithFor('a', [row({ id: 'a', subcategory: 'knit', status: 'archived' }), greyTrousers])).toEqual({ kind: 'inactive' });
  });

  it('groups matches by category, outfit-completing slots first', () => {
    const r = goesWithFor('seed', wardrobe);
    if (r.kind !== 'ok') throw new Error(r.kind);
    const cats = r.groups.map((g) => g.category);
    // A knit needs a bottom and shoes (slot 1) before a coat (0.5).
    expect(cats.slice(0, 2).sort()).toEqual(['bottom', 'footwear']);
    expect(cats).toContain('outerwear');
    expect(r.total).toBe(r.groups.reduce((s, g) => s + g.matches.length, 0));
    expect(r.seedConfirmed).toBe(true);
    for (const g of r.groups) {
      for (const m of g.matches) expect(m.reason.length).toBeGreaterThan(0);
      const scores = g.matches.map((m) => m.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it('never matches the seed with itself or with sold/archived items', () => {
    const sold = row({ id: 'sold', subcategory: 'jeans', colours: ['blue'], materials: ['denim'], status: 'sold' });
    const archived = row({ id: 'arch', subcategory: 'jeans', colours: ['blue'], materials: ['denim'], status: 'archived' });
    const r = goesWithFor('seed', [...wardrobe, sold, archived]);
    if (r.kind !== 'ok') throw new Error(r.kind);
    const ids = r.groups.flatMap((g) => g.matches.map((m) => m.item.id));
    expect(ids).not.toContain('seed');
    expect(ids).not.toContain('sold');
    expect(ids).not.toContain('arch');
  });

  it('keeps one category from crowding out the others', () => {
    const manyTrousers = Array.from({ length: 8 }, () => row({ subcategory: 'trousers', colours: ['grey'], materials: ['wool'], formality: 3 }));
    const r = goesWithFor('seed', [navyKnit, ...manyTrousers, whiteSneakers], { perCategory: 2 });
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.groups.find((g) => g.category === 'bottom')?.matches).toHaveLength(2);
    expect(r.groups.map((g) => g.category)).toContain('footwear');
  });

  it('caps the number of groups', () => {
    const r = goesWithFor('seed', wardrobe, { maxGroups: 1 });
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.groups).toHaveLength(1);
  });

  it('skips rows the engine cannot read and flags an unconfirmed seed', () => {
    const seed = { ...navyKnit, tags_confirmed_at: null };
    const r = goesWithFor('seed', [seed, row({ subcategory: null }), greyTrousers]);
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.seedConfirmed).toBe(false);
    expect(r.groups.flatMap((g) => g.matches.map((m) => m.item.id))).toEqual([greyTrousers.id]);
  });

  it('can leave out candidates whose tags are only AI suggestions', () => {
    const guess = row({ subcategory: 'jeans', colours: ['blue'], materials: ['denim'], tags_confirmed_at: null });
    const withGuess = goesWithFor('seed', [navyKnit, guess]);
    const without = goesWithFor('seed', [navyKnit, guess], { includeUnconfirmed: false });
    if (withGuess.kind !== 'ok' || without.kind !== 'ok') throw new Error('expected ok');
    expect(withGuess.groups[0]?.matches[0]?.tagsConfirmed).toBe(false);
    expect(without.total).toBe(0);
  });

  it('returns an empty ok result when nothing else is in the wardrobe', () => {
    expect(goesWithFor('seed', [navyKnit])).toEqual({ kind: 'ok', seedConfirmed: true, groups: [], total: 0 });
  });
});

describe('GROUP_TITLES', () => {
  it('has an English title for every category', () => {
    for (const cat of Object.keys(CATEGORIES)) expect(GROUP_TITLES[cat as keyof typeof CATEGORIES]).toMatch(/^[A-Z]/);
  });
});
