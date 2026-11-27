/**
 * M3 "What goes with this?" (#62 slice 2a): turns the user's wardrobe rows into engine input and groups the ranked
 * matches the way the item screen will show them ("Bottoms", "Shoes", …). Pure TypeScript: no network, no AI,
 * no Channel3 credits. The Supabase read lives in goesWithClient.ts; scoring lives in pairScore.ts.
 *
 * Grouping keeps one category from filling the whole list (ten white T-shirts would otherwise push every pair of
 * trousers out), and orders groups by what the seed needs to become an outfit, then by best score.
 */
import { rankMatches, slotBonus, type Match, type MatchItem, type RankOptions } from './pairScore';
import {
  CATEGORIES,
  COLOURS,
  FORMALITY,
  MATERIALS,
  PATTERNS,
  SEASONS,
  categoryOf,
  layerOf,
  type Category,
  type Colour,
  type Formality,
  type Material,
  type Pattern,
  type Season,
  type Subcategory,
} from './taxonomy';

/** The `clothing_items` columns goesWithClient.ts selects. Loosely typed: this is what comes back over the wire. */
export type GoesWithRow = {
  id: string;
  subcategory: string | null;
  colours: readonly string[] | null;
  pattern: string | null;
  materials: readonly string[] | null;
  formality: number | null;
  seasons: readonly string[] | null;
  status: string | null;
  tags_confirmed_at: string | null;
};

export const GOES_WITH_COLUMNS = 'id, subcategory, colours, pattern, materials, formality, seasons, status, tags_confirmed_at';

const SUBCATEGORIES = new Set<string>(Object.values(CATEGORIES).flat());
const STATUSES = new Set(['owned', 'for_sale', 'sold', 'archived']);

const known = <T extends string>(values: readonly string[] | null, allowed: (v: string) => boolean): T[] =>
  (values ?? []).filter(allowed) as T[];

/**
 * A row as engine input, or null when the item can't be matched yet (no garment type). Values outside the taxonomy are
 * dropped, so an old row or a taxonomy rename never crashes the engine; a dropped tag just scores as "no opinion".
 */
export function toMatchItem(row: GoesWithRow): MatchItem | null {
  if (!row.subcategory || !SUBCATEGORIES.has(row.subcategory)) return null;
  const pattern = row.pattern && (PATTERNS as readonly string[]).includes(row.pattern) ? (row.pattern as Pattern) : null;
  const formality = row.formality !== null && Object.hasOwn(FORMALITY, row.formality) ? (row.formality as Formality) : null;
  const status = row.status && STATUSES.has(row.status) ? (row.status as MatchItem['status']) : null;
  return {
    id: row.id,
    subcategory: row.subcategory as Subcategory,
    colours: known<Colour>(row.colours, (c) => Object.hasOwn(COLOURS, c)),
    pattern,
    materials: known<Material>(row.materials, (m) => Object.hasOwn(MATERIALS, m)),
    formality,
    seasons: known<Season>(row.seasons, (s) => (SEASONS as readonly string[]).includes(s)),
    status,
    tags_confirmed_at: row.tags_confirmed_at,
  };
}

export type GoesWithGroup = { category: Category; matches: Match[] };

export type GoesWithResult =
  /** The seed isn't in the rows (deleted, or not yours). */
  | { kind: 'not_found' }
  /** The seed has no garment type yet: the screen should send the user to Edit tags. */
  | { kind: 'needs_tags' }
  /** The seed is sold or archived: nothing to style it with. */
  | { kind: 'inactive' }
  | {
      kind: 'ok';
      /** False while the seed's own tags are AI suggestions; matches are then a first guess. */
      seedConfirmed: boolean;
      groups: GoesWithGroup[];
      /** Number of matches across all groups (0 = show the empty state). */
      total: number;
    };

export type GoesWithOptions = Pick<RankOptions, 'season' | 'includeUnconfirmed' | 'minScore'> & {
  /** Matches kept per category (default 3). */
  perCategory?: number;
  /** Groups kept (default 4). */
  maxGroups?: number;
};

/**
 * How much a seed needs a category to become an outfit, for ordering groups only (scores are untouched). Starts from
 * the engine's slot bonus, but treats a dress as the "lower half" a knit, cardigan or coat completes: without this,
 * dresses ranked last for those seeds and were cut by maxGroups (a staple womenswear pairing).
 */
export function groupNeed(seed: Subcategory, cat: Category): number {
  const base = slotBonus(seed, CATEGORIES[cat][0]);
  if (cat === 'one_piece' && (categoryOf(seed) === 'outerwear' || layerOf(seed) === 'mid')) return Math.max(base, 1);
  return base;
}

/** Ranked, grouped matches for one item against the rest of the user's wardrobe. */
export function goesWithFor(seedId: string, rows: readonly GoesWithRow[], opts: GoesWithOptions = {}): GoesWithResult {
  const { perCategory = 3, maxGroups = 4, ...rank } = opts;
  const seedRow = rows.find((r) => r.id === seedId);
  if (!seedRow) return { kind: 'not_found' };
  const seed = toMatchItem(seedRow);
  if (!seed) return { kind: 'needs_tags' };
  if (seed.status === 'sold' || seed.status === 'archived') return { kind: 'inactive' };

  const candidates = rows.filter((r) => r.id !== seedId).map(toMatchItem).filter((c): c is MatchItem => c !== null);
  const ranked = rankMatches(seed, candidates, { ...rank, limit: candidates.length });

  const byCategory = new Map<Category, Match[]>();
  for (const m of ranked) {
    const cat = categoryOf(m.item.subcategory);
    const list = byCategory.get(cat) ?? [];
    if (list.length < perCategory) list.push(m);
    byCategory.set(cat, list);
  }
  const need = (cat: Category) => groupNeed(seed.subcategory, cat);
  const groups = [...byCategory.entries()]
    .map(([category, matches]) => ({ category, matches }))
    .sort((a, b) => need(b.category) - need(a.category) || b.matches[0]!.score - a.matches[0]!.score)
    .slice(0, maxGroups);

  return {
    kind: 'ok',
    seedConfirmed: !!seed.tags_confirmed_at,
    groups,
    total: groups.reduce((n, g) => n + g.matches.length, 0),
  };
}

/** Section titles for the item screen. */
export const GROUP_TITLES: Record<Category, string> = {
  top: 'Tops',
  bottom: 'Bottoms',
  one_piece: 'Dresses & jumpsuits',
  outerwear: 'Coats & jackets',
  footwear: 'Shoes',
  accessory: 'Accessories',
};
