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

/**
 * Layer of a garment within its category. Items in the same category pair only if they are in different
 * layers (shirt under a knit under a coat). Bottoms, one-pieces, footwear and accessories have no layers.
 */
export type Layer = 'base' | 'mid' | 'outer';
const LAYERS: Partial<Record<Subcategory, Layer>> = {
  t_shirt: 'base', shirt: 'base', blouse: 'base', polo: 'base', tank_top: 'base',
  knit: 'mid', sweatshirt: 'mid', hoodie: 'mid', cardigan: 'mid', overshirt: 'mid', gilet: 'mid',
  coat: 'outer', jacket: 'outer', blazer: 'outer', parka: 'outer', raincoat: 'outer',
};

export function layerOf(sub: Subcategory): Layer | null {
  return LAYERS[sub] ?? null;
}

/** Can these two items be worn in the same outfit, slot-wise? */
export function canPair(a: Subcategory, b: Subcategory): boolean {
  if (a === b) return false;
  const ca = categoryOf(a);
  const cb = categoryOf(b);
  if (ca === 'accessory' && cb === 'accessory') return true; // a belt and a watch are fine
  if (ca === 'one_piece' && (cb === 'top' || cb === 'bottom')) return cb === 'top' && layerOf(b) !== 'base';
  if (cb === 'one_piece' && (ca === 'top' || ca === 'bottom')) return ca === 'top' && layerOf(a) !== 'base';
  const tops = (c: Category) => c === 'top' || c === 'outerwear';
  if (tops(ca) && tops(cb)) {
    const la = layerOf(a);
    const lb = layerOf(b);
    return la !== null && lb !== null && la !== lb;
  }
  return ca !== cb;
}

export function categoryOf(sub: Subcategory): Category {
  for (const [cat, subs] of Object.entries(CATEGORIES) as [Category, readonly string[]][]) {
    if (subs.includes(sub)) return cat;
  }
  throw new Error(`Unknown subcategory: ${sub}`);
}

/**
 * Named colour palette used for tags.
 * `hue` is the position on the painter's (RYB) colour wheel that stylists use, in degrees:
 * red 0, orange 60, yellow 120, green 180, blue 240, purple 300. On this wheel the classic pairs come out right
 * (red/green, blue/orange, yellow/purple are complementary). null = no hue (achromatic or metallic).
 * `tone`: light (pastels), mid, deep (jewel/dark tones). Same-tone colours sit together more easily.
 * `hex` is a representative screen colour (also used for Channel3 colour filters).
 */
export const COLOURS = {
  black: { hex: '#111111', hue: null, tone: 'deep', neutral: true },
  white: { hex: '#FFFFFF', hue: null, tone: 'light', neutral: true },
  off_white: { hex: '#F2EEE3', hue: null, tone: 'light', neutral: true },
  grey: { hex: '#8A8A8A', hue: null, tone: 'mid', neutral: true },
  charcoal: { hex: '#36454F', hue: null, tone: 'deep', neutral: true },
  silver: { hex: '#C0C0C0', hue: null, tone: 'light', neutral: true },
  gold: { hex: '#C8A951', hue: null, tone: 'mid', neutral: true },
  navy: { hex: '#1F2A44', hue: 245, tone: 'deep', neutral: true },
  beige: { hex: '#D8C3A5', hue: 75, tone: 'light', neutral: true },
  camel: { hex: '#C19A6B', hue: 70, tone: 'mid', neutral: true },
  brown: { hex: '#6B4423', hue: 50, tone: 'deep', neutral: true },
  olive: { hex: '#6B6B3A', hue: 150, tone: 'deep', neutral: true },
  denim_blue: { hex: '#4F6D8F', hue: 240, tone: 'mid', neutral: true },
  red: { hex: '#C0392B', hue: 0, tone: 'mid', neutral: false },
  burgundy: { hex: '#6D1A36', hue: 350, tone: 'deep', neutral: false },
  pink: { hex: '#E8A5B8', hue: 355, tone: 'light', neutral: false },
  orange: { hex: '#E67E22', hue: 60, tone: 'mid', neutral: false },
  rust: { hex: '#A0522D', hue: 40, tone: 'deep', neutral: false },
  yellow: { hex: '#F1C40F', hue: 120, tone: 'mid', neutral: false },
  mustard: { hex: '#C9A227', hue: 110, tone: 'deep', neutral: false },
  green: { hex: '#2E8B57', hue: 180, tone: 'mid', neutral: false },
  forest_green: { hex: '#228B22', hue: 185, tone: 'deep', neutral: false },
  mint: { hex: '#A8E6CF', hue: 175, tone: 'light', neutral: false },
  teal: { hex: '#1A7A7A', hue: 210, tone: 'deep', neutral: false },
  light_blue: { hex: '#A7C7E7', hue: 240, tone: 'light', neutral: false },
  blue: { hex: '#2A6FDB', hue: 240, tone: 'mid', neutral: false },
  purple: { hex: '#6C3483', hue: 300, tone: 'deep', neutral: false },
  lavender: { hex: '#C3B1E1', hue: 290, tone: 'light', neutral: false },
} as const satisfies Record<
  string,
  { hex: string; hue: number | null; tone: 'light' | 'mid' | 'deep'; neutral: boolean }
>;

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

export type ColourRelation = 'neutral' | 'monochrome' | 'analogous' | 'complementary' | 'triadic' | 'tonal' | 'contrast';

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Relation between two tagged colours on the RYB wheel. */
export function colourRelation(a: Colour, b: Colour): ColourRelation {
  const ca = COLOURS[a];
  const cb = COLOURS[b];
  if (ca.neutral || cb.neutral || ca.hue === null || cb.hue === null) return 'neutral';
  const d = hueDistance(ca.hue, cb.hue);
  if (d <= 15) return 'monochrome';
  if (d <= 60) return 'analogous';
  if (d >= 150) return 'complementary';
  if (d >= 105 && d <= 135) return 'triadic';
  // Hues in between can still work when both share a tone (two pastels, two jewel tones).
  if (ca.tone === cb.tone && ca.tone !== 'mid') return 'tonal';
  return 'contrast';
}

/** 0–1 score for how well two colours sit together. Neutrals pair with everything. */
export const COLOUR_RELATION_SCORE: Record<ColourRelation, number> = {
  neutral: 1,
  monochrome: 0.85,
  analogous: 0.8,
  tonal: 0.75,
  complementary: 0.7,
  triadic: 0.55,
  contrast: 0.45,
};

export function colourScore(a: Colour, b: Colour): number {
  return COLOUR_RELATION_SCORE[colourRelation(a, b)];
}

/**
 * Colour score for two items with up to 3 colours each (dominant first).
 * The dominant pair carries 70 %; the best secondary pairing adds 30 %, so a small neutral detail
 * can't rescue two clashing main colours.
 */
export function itemColourScore(a: readonly Colour[], b: readonly Colour[]): number {
  const [da, db] = [a[0], b[0]];
  if (da === undefined || db === undefined) return 0.5; // untagged: no opinion
  const dominant = colourScore(da, db);
  let best = dominant;
  for (const x of a) for (const y of b) if (x !== da || y !== db) best = Math.max(best, colourScore(x, y));
  return 0.7 * dominant + 0.3 * best;
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
