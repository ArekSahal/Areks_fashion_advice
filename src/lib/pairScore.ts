/**
 * M3 "What goes with this?" v1 (#62): rules-based pair score, ranking and stylist-style reasons.
 * Spec: docs/styling-engine.md §2. Pure TypeScript: no network, no AI, no Channel3 credits.
 *
 *   score = 0.35·colour + 0.25·formality + 0.15·pattern + 0.10·season + 0.15·slot_bonus
 *
 * Hard rules filter before scoring: slot clashes (`canPair`), a formality gap of 3+, a warmth gap of 3+ between pieces
 * that can't be layered, and items that are sold or archived. Two clashing prints (`isPrintClash`) keep their score but
 * lose 20 % (the most common clash, and the 0.15 pattern weight alone can't outweigh two neutral colours). Missing tags never block a pair;
 * they score as "no opinion".
 */
import {
  COLOURS,
  FORMALITY,
  MATERIALS,
  QUIET_PATTERNS,
  canPair,
  categoryOf,
  colourRelation,
  formalityScore,
  itemColourScore,
  layerOf,
  patternScore,
  seasonOverlap,
  type Category,
  type Colour,
  type Formality,
  type Material,
  type Pattern,
  type Season,
  type Subcategory,
} from './taxonomy';

/** The tag columns of `clothing_items` the engine reads. Everything but id and subcategory may be missing. */
export type MatchItem = {
  id: string;
  subcategory: Subcategory;
  colours?: readonly Colour[] | null;
  pattern?: Pattern | null;
  materials?: readonly Material[] | null;
  formality?: Formality | null;
  seasons?: readonly Season[] | null;
  status?: 'owned' | 'for_sale' | 'sold' | 'archived' | null;
  /** Null until the user confirmed the tags (then they are only AI suggestions). */
  tags_confirmed_at?: string | null;
};

export const PAIR_WEIGHTS = { colour: 0.35, formality: 0.25, pattern: 0.15, season: 0.1, slot: 0.15 } as const;
export type PairTerm = keyof typeof PAIR_WEIGHTS;

/** Score used for a term when one of the two items lacks the tag: no opinion, slightly below "fine". */
const NO_OPINION = 0.5;
/** Season mismatch in soft mode: allowed (layering, travel) but ranked lower. */
const SEASON_MISMATCH = 0.3;
const MAX_WARMTH_GAP = 2;
const MAX_FORMALITY_GAP = 2;
/** Multiplier when both pieces carry a loud print (patternScore < 1). */
export const PRINT_CLASH_FACTOR = 0.8;

export type PairOptions = {
  /** "For today": both items must suit this season (untagged = all-season). Otherwise season is a soft score. */
  season?: Season;
};

export type PairScore = {
  score: number;
  terms: Record<PairTerm, number>;
};

/** Why a pair was dropped before scoring, or null if it may be scored. */
export type PairBlock = 'same_item' | 'slot' | 'formality' | 'warmth' | 'status' | 'season' | null;

const INACTIVE = new Set(['sold', 'archived']);

/** Warmest material on the item (a wool coat with a cotton lining is a wool coat), or null when untagged. */
export function warmthOf(item: MatchItem): number | null {
  const ws = (item.materials ?? []).map((m) => MATERIALS[m]?.warmth).filter((w): w is 1 | 2 | 3 | 4 | 5 => !!w);
  return ws.length ? Math.max(...ws) : null;
}

export function pairBlock(a: MatchItem, b: MatchItem, opts: PairOptions = {}): PairBlock {
  if (a.id === b.id) return 'same_item';
  if (INACTIVE.has(a.status ?? '') || INACTIVE.has(b.status ?? '')) return 'status';
  if (!canPair(a.subcategory, b.subcategory)) return 'slot';
  if (a.formality && b.formality && Math.abs(a.formality - b.formality) > MAX_FORMALITY_GAP) return 'formality';
  // Pieces that are routinely layered with heavier ones are exempt: outerwear goes over anything, a base layer under
  // anything (silk blouse + wool trousers), dresses and skirts take a knit or cardigan (silk slip skirt + wool knit),
  // and accessories add warmth on purpose (wool scarf + silk dress). A cashmere jumper with linen shorts stays blocked.
  const layered = (i: MatchItem) => {
    const c = categoryOf(i.subcategory);
    return c === 'outerwear' || c === 'accessory' || c === 'one_piece' || i.subcategory === 'skirt' || layerOf(i.subcategory) === 'base';
  };
  const wa = warmthOf(a);
  const wb = warmthOf(b);
  if (!layered(a) && !layered(b) && wa !== null && wb !== null && Math.abs(wa - wb) > MAX_WARMTH_GAP) return 'warmth';
  if (opts.season && !(seasonOverlap(a.seasons ?? [], [opts.season]) && seasonOverlap(b.seasons ?? [], [opts.season]))) {
    return 'season';
  }
  return null;
}

/**
 * Slots each category needs to become an outfit (1) or can use (0.5). A top needs a bottom and shoes; a dress needs
 * shoes and something over it. Accessories finish any look but never complete one.
 */
const SLOT_NEEDS: Record<Category, Partial<Record<Category, number>>> = {
  top: { bottom: 1, footwear: 1, outerwear: 0.5, top: 0.5, accessory: 0.5 },
  bottom: { top: 1, footwear: 1, outerwear: 0.5, accessory: 0.5 },
  one_piece: { footwear: 1, outerwear: 1, top: 0.5, accessory: 0.5 },
  outerwear: { bottom: 1, footwear: 1, top: 0.5, one_piece: 0.5, outerwear: 0.5, accessory: 0.5 },
  footwear: { bottom: 1, one_piece: 1, top: 0.5, outerwear: 0.5, accessory: 0.5 },
  accessory: { top: 0.5, bottom: 0.5, one_piece: 0.5, outerwear: 0.5, footwear: 0.5, accessory: 0.25 },
};

export function slotBonus(seed: Subcategory, candidate: Subcategory): number {
  return SLOT_NEEDS[categoryOf(seed)][categoryOf(candidate)] ?? 0;
}

/**
 * Two loud prints that fight. Not a clash: a patterned accessory (ties are nearly always patterned), or a stripe with a
 * different print (stripe + check, Breton + floral are classic mixes; stripes act as a neutral print).
 */
export function isPrintClash(a: MatchItem, b: MatchItem): boolean {
  if (!a.pattern || !b.pattern || patternScore(a.pattern, b.pattern) >= 1) return false;
  if (categoryOf(a.subcategory) === 'accessory' || categoryOf(b.subcategory) === 'accessory') return false;
  if ((a.pattern === 'stripe') !== (b.pattern === 'stripe')) return false;
  return true;
}

/** Pair score 0–1 for two items that passed `pairBlock`. Asymmetric only through the slot bonus (seed's needs). */
export function pairScore(seed: MatchItem, candidate: MatchItem): PairScore {
  const ca = seed.colours ?? [];
  const cb = candidate.colours ?? [];
  const terms: Record<PairTerm, number> = {
    colour: itemColourScore(ca, cb),
    formality: seed.formality && candidate.formality ? formalityScore(seed.formality, candidate.formality) : NO_OPINION,
    pattern: seed.pattern && candidate.pattern ? patternScore(seed.pattern, candidate.pattern) : NO_OPINION,
    season: !seed.seasons?.length || !candidate.seasons?.length
      ? 1
      : seasonOverlap(seed.seasons, candidate.seasons) ? 1 : SEASON_MISMATCH,
    slot: slotBonus(seed.subcategory, candidate.subcategory),
  };
  let score = 0;
  for (const k of Object.keys(PAIR_WEIGHTS) as PairTerm[]) score += PAIR_WEIGHTS[k] * terms[k];
  if (isPrintClash(seed, candidate)) score *= PRINT_CLASH_FACTOR;
  return { score: Math.round(score * 1000) / 1000, terms };
}

// ---------- Reasons ----------

const PLURAL = new Set<Subcategory>([
  'jeans', 'trousers', 'chinos', 'shorts', 'joggers', 'leggings',
  'sneakers', 'boots', 'loafers', 'derbies', 'heels', 'flats', 'sandals', 'sunglasses', 'gloves',
]);
const SUB_WORD: Partial<Record<Subcategory, string>> = { t_shirt: 'T-shirt', tank_top: 'tank top', jewellery: 'jewellery' };
const FORMALITY_WORD: Record<string, string> = {
  very_casual: 'relaxed', casual: 'casual', smart_casual: 'smart-casual', business: 'business', formal: 'formal',
};

const word = (s: string) => s.replace(/_/g, ' ');

/** "the camel coat", "the grey trousers"; colour left out when untagged. */
const COLOUR_WORD: Partial<Record<Colour, string>> = { off_white: 'off-white', denim_blue: 'blue denim' };

/** A print names the piece better than its colour: "the striped shirt", not "the white shirt". */
const PATTERN_WORD: Partial<Record<Pattern, string>> = {
  stripe: 'striped', check: 'checked', floral: 'floral', polka_dot: 'polka-dot', animal: 'animal-print',
  graphic: 'graphic', logo: 'logo', camouflage: 'camo', paisley: 'paisley', abstract: 'abstract-print',
  colour_block: 'colour-block', houndstooth: 'houndstooth',
};

export function itemName(item: MatchItem): string {
  const sub = SUB_WORD[item.subcategory] ?? word(item.subcategory);
  const pw = item.pattern ? PATTERN_WORD[item.pattern] : undefined;
  if (pw) return `the ${pw} ${sub}`;
  const c = item.colours?.[0];
  // "the blue jeans", not "the blue denim jeans"
  const cw = c === 'denim_blue' && item.subcategory === 'jeans' ? 'blue' : c ? (COLOUR_WORD[c] ?? word(c)) : '';
  const colour = cw ? `${cw} ` : '';
  return `the ${colour}${sub}`;
}

const isLoud = (item: MatchItem) => !!item.pattern && !QUIET_PATTERNS.includes(item.pattern);
const isPlural = (item: MatchItem) => PLURAL.has(item.subcategory);
const verb = (item: MatchItem, one: string, many: string) => (isPlural(item) ? many : one);

/** Earthy neutrals that warm up the cool ones (grey, navy, black, white). */
const WARM_NEUTRALS = new Set<Colour>(['camel', 'beige', 'brown', 'olive', 'gold']);

/** `short` replaces `text` when the reason comes second and the first already named both items. */
type Reason = { term: PairTerm; strength: number; text: string; short?: string };

function colourReason(a: MatchItem, b: MatchItem, score: number): Reason | null {
  const ca = a.colours?.[0];
  const cb = b.colours?.[0];
  if (!ca || !cb) return null;
  // A printed piece is named by its print ("the striped shirt"), so a sentence about its colour would read wrong.
  if (isLoud(a) || isLoud(b)) return null;
  const rel = colourRelation(ca, cb);
  const A = itemName(a);
  const B = itemName(b);
  let text: string | null = null;
  if (rel === 'neutral') {
    if (ca === cb) text = `${A} and ${B} make an easy tonal look`;
    else if (COLOURS[ca].neutral && COLOURS[cb].neutral) {
      const warm = WARM_NEUTRALS.has(ca) ? a : WARM_NEUTRALS.has(cb) ? b : null;
      const cool = warm === a ? (WARM_NEUTRALS.has(cb) ? null : b) : warm === b ? (WARM_NEUTRALS.has(ca) ? null : a) : null;
      text = warm && cool
        ? `${itemName(warm)} ${verb(warm, 'warms', 'warm')} up ${itemName(cool)}`
        : `${A} and ${B} are both neutrals, so they pair easily`;
    }
    else {
      // The neutral piece is the anchor; the coloured one leads.
      const [n, o] = COLOURS[ca].neutral ? [a, b] : [b, a];
      text = `${itemName(n)} ${verb(n, 'is', 'are')} a neutral, so ${verb(n, 'it lets', 'they let')} ${itemName(o)} take the lead`;
    }
  } else if (rel === 'monochrome') text = `${A} and ${B} are shades of the same colour, which looks deliberate`;
  else if (rel === 'analogous') text = `${A} and ${B} sit side by side on the colour wheel, so they blend`;
  else if (rel === 'tonal') {
    text = `${A} and ${B} share the same ${COLOURS[ca].tone === 'light' ? 'soft, pastel' : 'deep, rich'} depth of colour`;
  } else if (rel === 'complementary') text = `${A} and ${B} are opposite colours, a confident contrast`;
  return text ? { term: 'colour', strength: PAIR_WEIGHTS.colour * score, text } : null;
}

function formalityReason(a: MatchItem, b: MatchItem, score: number): Reason | null {
  if (!a.formality || !b.formality) return null;
  const gap = Math.abs(a.formality - b.formality);
  let text: string | null = null;
  let short: string | undefined;
  if (gap === 0) text = `both sit at the same ${FORMALITY_WORD[FORMALITY[a.formality]]} level`;
  else if (gap === 1) text = `they're close in how dressed-up they are`;
  else if (gap === 2) {
    const [smart, casual] = a.formality > b.formality ? [a, b] : [b, a];
    text = `pairing ${itemName(smart)} with ${itemName(casual)} is a deliberate high-low contrast`;
    short = smart.formality! >= 4 ? 'the mix of smart and casual is deliberate' : 'a relaxed take that still looks put together';
  }
  return text ? { term: 'formality', strength: PAIR_WEIGHTS.formality * score, text, short } : null;
}

function patternReason(a: MatchItem, b: MatchItem, score: number): Reason | null {
  if (!a.pattern || !b.pattern) return null;
  const qa = QUIET_PATTERNS.includes(a.pattern);
  const qb = QUIET_PATTERNS.includes(b.pattern);
  if (qa && qb) return null; // two plain pieces say nothing
  if (!qa && !qb) {
    if (isPrintClash(a, b)) return null; // a clash is a weakness, never a reason
    const text = a.pattern === 'stripe' || b.pattern === 'stripe'
      ? `the stripes act as a neutral print, so ${itemName(a)} and ${itemName(b)} mix well`
      : `the print on ${itemName(categoryOf(a.subcategory) === 'accessory' ? a : b)} adds interest without competing`;
    return { term: 'pattern', strength: PAIR_WEIGHTS.pattern * score, text };
  }
  const [plain, printed] = qa ? [a, b] : [b, a];
  const text = `${itemName(plain)} ${verb(plain, 'keeps', 'keep')} it calm, so ${itemName(printed)} can stand out`;
  return { term: 'pattern', strength: PAIR_WEIGHTS.pattern * score, text };
}

/**
 * One sentence a stylist would say: the two strongest reasons, e.g.
 * "The grey trousers are a neutral, so they let the camel coat take the lead, and both sit at the same smart-casual level."
 */
export function explainPair(seed: MatchItem, candidate: MatchItem, ps: PairScore = pairScore(seed, candidate)): string {
  const reasons = [
    colourReason(seed, candidate, ps.terms.colour),
    formalityReason(seed, candidate, ps.terms.formality),
    patternReason(seed, candidate, ps.terms.pattern),
  ]
    .filter((r): r is Reason => r !== null)
    .sort((x, y) => y.strength - x.strength)
    .slice(0, 2);
  if (reasons.length === 0) return `${capitalise(itemName(candidate))} ${verb(candidate, 'rounds', 'round')} off the outfit.`;
  return `${capitalise(reasons.map((r, i) => (i > 0 && r.short) || r.text).join(', and '))}.`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Ranking ----------

export type Match = {
  item: MatchItem;
  score: number;
  terms: Record<PairTerm, number>;
  reason: string;
  /** False when the candidate's tags are still AI suggestions; the UI should say so. */
  tagsConfirmed: boolean;
};

export type RankOptions = PairOptions & {
  limit?: number;
  /** Include candidates whose tags aren't confirmed yet (default true; they're flagged in the result). */
  includeUnconfirmed?: boolean;
  /** Drop matches below this score (default 0.75: below that the stylist would rather say nothing). */
  minScore?: number;
};

/** Tuned on eval/pairs.json: every "bad" pair scores below it, every "good" and "ok" pair above. */
export const DEFAULT_MIN_SCORE = 0.75;

/** Rank the user's other items for "What goes with this?". Best first; ties keep the input order. */
export function rankMatches(seed: MatchItem, candidates: readonly MatchItem[], opts: RankOptions = {}): Match[] {
  const { limit = 10, includeUnconfirmed = true, minScore = DEFAULT_MIN_SCORE } = opts;
  const out: Match[] = [];
  for (const c of candidates) {
    if (!includeUnconfirmed && !c.tags_confirmed_at) continue;
    if (pairBlock(seed, c, opts) !== null) continue;
    const ps = pairScore(seed, c);
    if (ps.score < minScore) continue;
    out.push({ item: c, score: ps.score, terms: ps.terms, reason: explainPair(seed, c, ps), tagsConfirmed: !!c.tags_confirmed_at });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
