import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_SCORE,
  PAIR_WEIGHTS,
  explainPair,
  isPrintClash,
  itemName,
  pairBlock,
  pairScore,
  rankMatches,
  slotBonus,
  warmthOf,
  type MatchItem,
} from './pairScore';

let n = 0;
const item = (p: Omit<MatchItem, 'id'> & { id?: string }): MatchItem => ({
  id: p.id ?? `i${++n}`,
  tags_confirmed_at: '2026-11-01T00:00:00Z',
  status: 'owned',
  ...p,
});

const camelCoat = item({ subcategory: 'coat', colours: ['camel'], formality: 4, pattern: 'solid', materials: ['wool'] });
const greyTrousers = item({ subcategory: 'trousers', colours: ['grey'], formality: 4, pattern: 'solid', materials: ['wool'] });

describe('pair score', () => {
  it('weights sum to 1', () => {
    expect(Object.values(PAIR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('scores a classic pair near the top', () => {
    const s = pairScore(camelCoat, greyTrousers);
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.terms).toMatchObject({ colour: 1, formality: 1, pattern: 1, season: 1, slot: 1 });
  });

  it('treats missing tags as no opinion, never as a block', () => {
    const bare = item({ subcategory: 'jeans' });
    expect(pairBlock(camelCoat, bare)).toBeNull();
    const s = pairScore(camelCoat, bare);
    expect(s.terms.colour).toBe(0.5);
    expect(s.terms.formality).toBe(0.5);
    expect(s.terms.pattern).toBe(0.5);
    expect(s.terms.season).toBe(1);
  });

  it('takes 20 % off two loud prints', () => {
    const check = item({ subcategory: 'shirt', pattern: 'check', colours: ['navy'], formality: 3 });
    const floral = item({ subcategory: 'shorts', pattern: 'floral', colours: ['beige'], formality: 3 });
    const plain = { ...floral, pattern: 'solid' as const };
    expect(pairScore(check, floral).score).toBeCloseTo(pairScore(check, plain).score * 0.8 - 0.15 * 0.7 * 0.8, 2);
  });

  it('does not penalise stripe + another print or a patterned accessory', () => {
    const stripe = item({ subcategory: 'shirt', pattern: 'stripe', formality: 4 });
    const checkBlazer = item({ subcategory: 'blazer', pattern: 'check', formality: 4 });
    const dotTie = item({ subcategory: 'tie', pattern: 'polka_dot', formality: 4 });
    const floral = item({ subcategory: 'skirt', pattern: 'floral' });
    const animal = item({ subcategory: 'blouse', pattern: 'animal' });
    expect(isPrintClash(stripe, checkBlazer)).toBe(false);
    expect(isPrintClash(stripe, dotTie)).toBe(false);
    expect(isPrintClash(animal, floral)).toBe(true);
    expect(isPrintClash(stripe, { ...stripe, id: 'x', subcategory: 'trousers' })).toBe(true); // stripe on stripe
  });

  it('soft-scores a season mismatch', () => {
    const summer = item({ subcategory: 'shorts', seasons: ['summer'] });
    const winter = item({ subcategory: 'knit', seasons: ['winter'] });
    expect(pairScore(winter, summer).terms.season).toBe(0.3);
  });

  it('gives the slot bonus from the seed’s needs', () => {
    expect(slotBonus('t_shirt', 'jeans')).toBe(1);
    expect(slotBonus('dress', 'coat')).toBe(1);
    expect(slotBonus('t_shirt', 'coat')).toBe(0.5);
    expect(slotBonus('watch', 'jeans')).toBe(0.5);
  });
});

describe('hard rules', () => {
  it('blocks the same item, slot clashes and inactive items', () => {
    expect(pairBlock(camelCoat, camelCoat)).toBe('same_item');
    expect(pairBlock(item({ subcategory: 'jeans' }), item({ subcategory: 'chinos' }))).toBe('slot');
    expect(pairBlock(camelCoat, item({ subcategory: 'jeans', status: 'sold' }))).toBe('status');
    expect(pairBlock(camelCoat, item({ subcategory: 'jeans', status: 'archived' }))).toBe('status');
    expect(pairBlock(camelCoat, item({ subcategory: 'jeans', status: 'for_sale' }))).toBeNull();
  });

  it('blocks a formality gap of 3+', () => {
    const hoodie = item({ subcategory: 'hoodie', formality: 1 });
    expect(pairBlock(hoodie, item({ subcategory: 'trousers', formality: 4 }))).toBe('formality');
    expect(pairBlock(hoodie, item({ subcategory: 'chinos', formality: 3 }))).toBeNull();
  });

  it('drops a warmth gap of 3+ unless one piece is outerwear or a base layer', () => {
    const silkBlouse = item({ subcategory: 'blouse', materials: ['silk'] });
    expect(pairBlock(silkBlouse, item({ subcategory: 'trousers', materials: ['wool'] }))).toBeNull();
    const woolKnit = item({ subcategory: 'knit', materials: ['wool'] });
    expect(pairBlock(woolKnit, item({ subcategory: 'skirt', materials: ['silk'] }))).toBeNull();
    expect(pairBlock(item({ subcategory: 'dress', materials: ['viscose'] }), item({ subcategory: 'cardigan', materials: ['cashmere'] }))).toBeNull();
    expect(pairBlock(item({ subcategory: 'scarf', materials: ['wool'] }), item({ subcategory: 'dress', materials: ['silk'] }))).toBeNull();
    const linenShorts = item({ subcategory: 'shorts', materials: ['linen'] });
    const cashmere = item({ subcategory: 'knit', materials: ['cashmere'] });
    expect(pairBlock(cashmere, linenShorts)).toBe('warmth');
    const parka = item({ subcategory: 'parka', materials: ['down'] });
    const linenShirt = item({ subcategory: 'shirt', materials: ['linen'] });
    expect(pairBlock(parka, linenShirt)).toBeNull();
  });

  it('uses the warmest material', () => {
    expect(warmthOf(item({ subcategory: 'coat', materials: ['cotton', 'wool'] }))).toBe(4);
    expect(warmthOf(item({ subcategory: 'coat' }))).toBeNull();
  });

  it('filters by season "for today", treating untagged as all-season', () => {
    const summerOnly = item({ subcategory: 'shorts', seasons: ['summer'] });
    expect(pairBlock(camelCoat, summerOnly, { season: 'winter' })).toBe('season');
    expect(pairBlock(camelCoat, greyTrousers, { season: 'winter' })).toBeNull();
  });
});

describe('reasons', () => {
  it('names items naturally', () => {
    expect(itemName(camelCoat)).toBe('the camel coat');
    expect(itemName(item({ subcategory: 't_shirt', colours: ['off_white'] }))).toBe('the off-white T-shirt');
    expect(itemName(item({ subcategory: 'jeans' }))).toBe('the jeans');
  });

  it('gives the two strongest reasons in one sentence, with plural agreement', () => {
    const r = explainPair(camelCoat, greyTrousers);
    expect(r).toBe(
      'The camel coat warms up the grey trousers, and both sit at the same business level.',
    );
  });

  it('explains a deliberate formality contrast and a single print', () => {
    const blazer = item({ subcategory: 'blazer', colours: ['navy'], formality: 4, pattern: 'solid' });
    const jeans = item({ subcategory: 'jeans', colours: ['denim_blue'], formality: 2, pattern: 'solid' });
    expect(explainPair(blazer, jeans)).toBe(
      'The navy blazer and the blue jeans are both neutrals, so they pair easily, and the mix of smart and casual is deliberate.',
    );
    const yellow = item({ subcategory: 'blouse', colours: ['yellow'], formality: 4 });
    const teal = item({ subcategory: 'skirt', colours: ['teal'], formality: 2 });
    expect(explainPair(yellow, teal)).toBe('Pairing the yellow blouse with the teal skirt is a deliberate high-low contrast.');
    const floral = item({ subcategory: 'dress', colours: ['pink'], formality: 2, pattern: 'floral' });
    const denim = item({ subcategory: 'jacket', colours: ['denim_blue'], formality: 2, pattern: 'solid' });
    expect(explainPair(floral, denim)).toBe(
      'Both sit at the same casual level, and the blue denim jacket keeps it calm, so the floral dress can stand out.',
    );
    const stripe = item({ subcategory: 'shirt', colours: ['white'], pattern: 'stripe', formality: 4 });
    const check = item({ subcategory: 'blazer', colours: ['navy'], pattern: 'check', formality: 4 });
    expect(explainPair(stripe, check)).toBe(
      'Both sit at the same business level, and the stripes act as a neutral print, so the striped shirt and the checked blazer mix well.',
    );
    const printOnly = item({ subcategory: 'dress', pattern: 'floral' });
    const plainOnly = item({ subcategory: 'jacket', pattern: 'solid' });
    expect(explainPair(printOnly, plainOnly)).toBe('The jacket keeps it calm, so the floral dress can stand out.');
    expect(itemName(item({ subcategory: 'shirt', colours: ['white'], pattern: 'stripe' }))).toBe('the striped shirt');
    expect(itemName(denim)).toBe('the blue denim jacket');
  });

  it('names the neutral piece as the anchor', () => {
    const red = item({ subcategory: 'knit', colours: ['red'] });
    const jeans = item({ subcategory: 'jeans', colours: ['denim_blue'] });
    expect(explainPair(red, jeans)).toBe('The blue jeans are a neutral, so they let the red knit take the lead.');
  });

  it('falls back to a plain sentence when no rule says anything', () => {
    expect(explainPair(item({ subcategory: 't_shirt' }), item({ subcategory: 'sneakers' }))).toBe(
      'The sneakers round off the outfit.',
    );
  });
});

describe('rankMatches', () => {
  const tee = item({ subcategory: 't_shirt', colours: ['white'], formality: 2, pattern: 'solid', materials: ['cotton'] });
  const wardrobe = [
    item({ id: 'chinos', subcategory: 'chinos', colours: ['navy'], formality: 3, pattern: 'solid' }),
    item({ id: 'jeans', subcategory: 'jeans', colours: ['denim_blue'], formality: 2, pattern: 'solid' }),
    item({ id: 'suit', subcategory: 'trousers', colours: ['charcoal'], formality: 5, pattern: 'solid' }),
    item({ id: 'tee2', subcategory: 't_shirt', colours: ['black'], formality: 2 }),
    item({ id: 'sold', subcategory: 'shorts', colours: ['beige'], formality: 2, status: 'sold' }),
    item({ id: 'new', subcategory: 'sneakers', colours: ['white'], formality: 2, tags_confirmed_at: null }),
  ];

  it('ranks best first and drops blocked and weak pairs', () => {
    const ids = rankMatches(tee, wardrobe).map((m) => m.item.id);
    expect(ids[0]).toBe('jeans');
    expect(ids).toContain('chinos');
    expect(ids).not.toContain('tee2');
    expect(ids).not.toContain('sold');
    expect(ids).not.toContain('suit'); // formality gap 3 → blocked
  });

  it('flags unconfirmed tags, or leaves them out on request', () => {
    const m = rankMatches(tee, wardrobe).find((x) => x.item.id === 'new');
    expect(m?.tagsConfirmed).toBe(false);
    expect(rankMatches(tee, wardrobe, { includeUnconfirmed: false }).map((x) => x.item.id)).not.toContain('new');
  });

  it('respects limit and minScore and attaches a reason', () => {
    const top = rankMatches(tee, wardrobe, { limit: 1 });
    expect(top).toHaveLength(1);
    expect(top[0]!.reason).toMatch(/\.$/);
    expect(rankMatches(tee, wardrobe, { minScore: 1.01 })).toHaveLength(0);
    for (const m of rankMatches(tee, wardrobe)) expect(m.score).toBeGreaterThanOrEqual(DEFAULT_MIN_SCORE);
  });
});

// ---------- Evaluation set (docs/styling-engine.md §7) ----------

type EvalPair = {
  wear: 'menswear' | 'womenswear' | 'unisex';
  label: 'good' | 'ok' | 'bad';
  seed: Omit<MatchItem, 'id'>;
  candidate: Omit<MatchItem, 'id'>;
  reason: string;
};

describe('evaluation set', () => {
  const { pairs } = JSON.parse(readFileSync(join(process.cwd(), 'eval/pairs.json'), 'utf8')) as { pairs: EvalPair[] };
  /** Blocked pairs score 0: the engine would never show them. */
  const scored = pairs.map((p) => {
    const a = { ...p.seed, id: 'seed' } as MatchItem;
    const b = { ...p.candidate, id: 'cand' } as MatchItem;
    return { ...p, score: pairBlock(a, b) ? 0 : pairScore(a, b).score };
  });
  const by = (l: EvalPair['label']) => scored.filter((p) => p.label === l);

  it('is roughly balanced between menswear and womenswear', () => {
    const m = pairs.filter((p) => p.wear === 'menswear').length;
    const w = pairs.filter((p) => p.wear === 'womenswear').length;
    expect(Math.abs(m - w)).toBeLessThanOrEqual(Math.max(2, pairs.length * 0.1));
  });

  it('shows every good and ok pair and hides every bad one at the default minimum score', () => {
    for (const p of [...by('good'), ...by('ok')]) expect(p.score, p.reason).toBeGreaterThanOrEqual(DEFAULT_MIN_SCORE);
    for (const p of by('bad')) expect(p.score, p.reason).toBeLessThan(DEFAULT_MIN_SCORE);
  });

  it('ranks good above bad (pairwise accuracy) and keeps the label means in order', () => {
    const good = by('good');
    const bad = by('bad');
    let wins = 0;
    for (const g of good) for (const b of bad) wins += g.score > b.score ? 1 : g.score === b.score ? 0.5 : 0;
    const accuracy = wins / (good.length * bad.length);
    const mean = (xs: { score: number }[]) => xs.reduce((s, x) => s + x.score, 0) / xs.length;
    console.info(
      `[eval] ${pairs.length} pairs · good>bad accuracy ${accuracy.toFixed(3)} · mean good ${mean(good).toFixed(3)} ` +
        `· ok ${mean(by('ok')).toFixed(3)} · bad ${mean(bad).toFixed(3)}`,
    );
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
    expect(mean(good)).toBeGreaterThan(mean(by('ok')));
    expect(mean(by('ok'))).toBeGreaterThan(mean(bad));
  });
});
