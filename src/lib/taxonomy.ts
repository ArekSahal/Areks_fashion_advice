/**
 * Garment attribute taxonomy v1 (owner: Fashion agent, see docs/styling-engine.md).
 * Single source of truth for AI tagging, filters, matching rules and the database check constraints.
 * Values are stable snake_case ids; display names live in the UI layer (Swedish + English).
 */

export const CATEGORIES = {
  top: ['t_shirt', 'shirt', 'blouse', 'polo', 'knit', 'sweatshirt', 'hoodie', 'tank_top', 'cardigan'],
  bottom: ['jeans', 'trousers', 'chinos', 'shorts', 'skirt', 'joggers', 'leggings'],
  one_piece: ['dress', 'jumpsuit'],
  outerwear: ['coat', 'jacket', 'blazer', 'parka', 'gilet', 'raincoat', 'overshirt'],
  footwear: ['sneakers', 'boots', 'loafers', 'derbies', 'heels', 'flats', 'sandals'],
  accessory: ['bag', 'belt', 'scarf', 'hat', 'cap', 'sunglasses', 'jewellery', 'watch', 'tie', 'gloves'],
} as const;

export type Category = keyof typeof CATEGORIES;
export type Subcategory = (typeof CATEGORIES)[Category][number];

export function categoryOf(sub: Subcategory): Category {
  for (const [cat, subs] of Object.entries(CATEGORIES) as [Category, readonly string[]][]) {
    if (subs.includes(sub)) return cat;
  }
  throw new Error(`Unknown subcategory: ${sub}`);
}

/**
 * Named colour palette used for tags. `hue` in degrees (null for neutrals), used for harmony rules.
 * `hex` is a representative value (also used for Channel3 colour filters).
 */
export const COLOURS = {
  black: { hex: '#111111', hue: null, neutral: true },
  white: { hex: '#FFFFFF', hue: null, neutral: true },
  off_white: { hex: '#F2EEE3', hue: null, neutral: true },
  grey: { hex: '#8A8A8A', hue: null, neutral: true },
  charcoal: { hex: '#36454F', hue: null, neutral: true },
  navy: { hex: '#1F2A44', hue: 225, neutral: true },
  beige: { hex: '#D8C3A5', hue: 35, neutral: true },
  camel: { hex: '#C19A6B', hue: 33, neutral: true },
  brown: { hex: '#6B4423', hue: 25, neutral: true },
  olive: { hex: '#6B6B3A', hue: 60, neutral: true },
  denim_blue: { hex: '#4F6D8F', hue: 212, neutral: true },
  red: { hex: '#C0392B', hue: 5, neutral: false },
  burgundy: { hex: '#6D1A36', hue: 340, neutral: false },
  pink: { hex: '#E8A5B8', hue: 345, neutral: false },
  orange: { hex: '#E67E22', hue: 28, neutral: false },
  rust: { hex: '#A0522D', hue: 19, neutral: false },
  yellow: { hex: '#F1C40F', hue: 48, neutral: false },
  mustard: { hex: '#C9A227', hue: 46, neutral: false },
  green: { hex: '#2E8B57', hue: 146, neutral: false },
  forest_green: { hex: '#228B22', hue: 120, neutral: false },
  mint: { hex: '#A8E6CF', hue: 158, neutral: false },
  light_blue: { hex: '#A7C7E7', hue: 210, neutral: false },
  blue: { hex: '#2A6FDB', hue: 216, neutral: false },
  teal: { hex: '#1A7A7A', hue: 180, neutral: false },
  purple: { hex: '#6C3483', hue: 282, neutral: false },
  lavender: { hex: '#C3B1E1', hue: 263, neutral: false },
  gold: { hex: '#C8A951', hue: 45, neutral: false },
  silver: { hex: '#C0C0C0', hue: null, neutral: true },
} as const satisfies Record<string, { hex: string; hue: number | null; neutral: boolean }>;

export type Colour = keyof typeof COLOURS;

export const PATTERNS = [
  'solid', 'stripe', 'check', 'herringbone', 'houndstooth', 'floral', 'polka_dot', 'paisley',
  'camouflage', 'animal', 'graphic', 'logo', 'abstract', 'colour_block', 'knit_texture',
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** Patterns that read as texture rather than a print; they mix easily. */
export const QUIET_PATTERNS: readonly Pattern[] = ['solid', 'herringbone', 'knit_texture'];

export const MATERIALS = {
  cotton: { warmth: 2 }, linen: { warmth: 1 }, wool: { warmth: 4 }, cashmere: { warmth: 4 },
  merino: { warmth: 3 }, denim: { warmth: 2 }, leather: { warmth: 3 }, suede: { warmth: 3 },
  silk: { warmth: 1 }, polyester: { warmth: 2 }, nylon: { warmth: 2 }, viscose: { warmth: 1 },
  fleece: { warmth: 4 }, down: { warmth: 5 }, corduroy: { warmth: 3 }, tweed: { warmth: 4 },
  jersey: { warmth: 2 }, canvas: { warmth: 2 }, synthetic_blend: { warmth: 2 },
} as const satisfies Record<string, { warmth: 1 | 2 | 3 | 4 | 5 }>;
export type Material = keyof typeof MATERIALS;

export const FITS = ['slim', 'regular', 'relaxed', 'oversized', 'cropped', 'tailored'] as const;
export type Fit = (typeof FITS)[number];

/** 1 = very casual (gym, lounge) … 5 = formal (black tie). */
export const FORMALITY = {
  1: 'very_casual',
  2: 'casual',
  3: 'smart_casual',
  4: 'business',
  5: 'formal',
} as const;
export type Formality = keyof typeof FORMALITY;

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const OCCASIONS = [
  'everyday', 'work', 'evening', 'party', 'wedding', 'sport', 'outdoor', 'travel', 'lounge',
] as const;
export type Occasion = (typeof OCCASIONS)[number];

// ---------- Colour harmony ----------

export type ColourRelation = 'neutral' | 'monochrome' | 'analogous' | 'complementary' | 'triadic' | 'clash';

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Classic colour-wheel relation between two tagged colours. */
export function colourRelation(a: Colour, b: Colour): ColourRelation {
  const ca = COLOURS[a];
  const cb = COLOURS[b];
  if (ca.neutral || cb.neutral || ca.hue === null || cb.hue === null) return 'neutral';
  const d = hueDistance(ca.hue, cb.hue);
  if (d <= 15) return 'monochrome';
  if (d <= 50) return 'analogous';
  if (d >= 150) return 'complementary';
  if (d >= 105 && d <= 135) return 'triadic';
  return 'clash';
}

/** 0–1 score for how well two colours sit together. Neutrals pair with everything. */
export const COLOUR_RELATION_SCORE: Record<ColourRelation, number> = {
  neutral: 1,
  monochrome: 0.85,
  analogous: 0.8,
  complementary: 0.7,
  triadic: 0.55,
  clash: 0.25,
};

export function colourScore(a: Colour, b: Colour): number {
  return COLOUR_RELATION_SCORE[colourRelation(a, b)];
}

// ---------- Other pairwise rules ----------

/** Formality gap of 0–1 is fine, 2 is a deliberate contrast (e.g. blazer + jeans), 3+ rarely works. */
export function formalityScore(a: Formality, b: Formality): number {
  const gap = Math.abs(a - b);
  return [1, 0.85, 0.5, 0.15, 0][gap] ?? 0;
}

/** Two busy prints compete; one print + quiet pieces is safe. */
export function patternScore(a: Pattern, b: Pattern): number {
  const aQuiet = QUIET_PATTERNS.includes(a);
  const bQuiet = QUIET_PATTERNS.includes(b);
  if (aQuiet || bQuiet) return 1;
  if (a === b && (a === 'stripe' || a === 'check')) return 0.4; // same print twice: needs scale contrast
  return 0.3;
}

export function seasonOverlap(a: readonly Season[], b: readonly Season[]): boolean {
  if (a.length === 0 || b.length === 0) return true; // untagged = all-season
  return a.some((s) => b.includes(s));
}
