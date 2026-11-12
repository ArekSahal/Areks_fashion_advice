/**
 * AI tagging contract (owner: Fashion agent, see docs/styling-engine.md and docs/ai-providers.md).
 *
 * The `tag-item` Edge Function sends one (face-blurred) photo to the vision model with TAGGING_PROMPT and
 * TAGGING_RESPONSE_SCHEMA, then runs the model's JSON through parseTaggingResponse(). Everything here is pure
 * TypeScript built from taxonomy.ts, so the prompt, the schema, the validator and the database check constraints
 * can't drift apart.
 */
import {
  CATEGORIES,
  COLOURS,
  FITS,
  FORMALITY,
  MATERIALS,
  OCCASIONS,
  PATTERNS,
  SEASONS,
  type Category,
  type Colour,
  type Fit,
  type Formality,
  type Material,
  type Occasion,
  type Pattern,
  type Season,
  type Subcategory,
  categoryOf,
} from './taxonomy';

export const MAX_COLOURS = 3; // matches the clothing_items check constraint
export const MAX_MATERIALS = 4;
/** Below this the UI shows the field as "check this" (docs/styling-engine.md). */
export const CHECK_THRESHOLD = 0.6;
/** Below this the guess is dropped and the field is left empty for the user. */
export const DROP_THRESHOLD = 0.3;

export const TAG_FIELDS = [
  'category', 'subcategory', 'colours', 'pattern', 'materials', 'fit', 'formality', 'seasons', 'occasions',
] as const;
export type TagField = (typeof TAG_FIELDS)[number];

export interface ItemTags {
  category: Category | null;
  subcategory: Subcategory | null;
  colours: Colour[];
  pattern: Pattern | null;
  materials: Material[];
  fit: Fit | null;
  formality: Formality | null;
  seasons: Season[];
  occasions: Occasion[];
}

export type TaggingWarning = 'multiple_garments' | 'subcategory_mismatch';

export type TaggingResult =
  | {
      ok: true;
      tags: ItemTags;
      /** Model confidence per field (0–1), stored in clothing_items.tag_confidence. */
      confidence: Partial<Record<TagField, number>>;
      /** Fields the user should look at before saving. */
      needsCheck: TagField[];
      warnings: TaggingWarning[];
    }
  | { ok: false; reason: 'not_garment' | 'invalid_response'; message: string };

const SUBCATEGORIES = Object.values(CATEGORIES).flat() as Subcategory[];
const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];
const COLOUR_IDS = Object.keys(COLOURS) as Colour[];
const MATERIAL_IDS = Object.keys(MATERIALS) as Material[];
const FORMALITY_IDS = Object.keys(FORMALITY).map(Number) as Formality[];

// ---------- Prompt ----------

export const TAGGING_PROMPT = [
  'You are an experienced personal stylist cataloguing one garment from a customer\'s wardrobe photo.',
  'Tag the single most prominent clothing item, shoe or accessory in the photo. Ignore the background, the person',
  'wearing it and any other items. Use only the allowed values in the response schema.',
  '',
  'Rules:',
  '- colours: up to 3, dominant colour first. Denim is "denim_blue"; cream and ecru are "off_white".',
  '- pattern: "solid" when there is no visible print; use "knit_texture" for cable or rib knits without a print.',
  '- materials: only what you can reasonably judge from the photo, main fabric first. Leave empty if unsure.',
  `- formality: ${FORMALITY_IDS.map((f) => `${f} = ${FORMALITY[f].replace('_', ' ')}`).join(', ')}.`,
  '- seasons: the seasons it suits in a Northern European climate. Leave empty if it works all year.',
  '- occasions: where it would typically be worn.',
  '- confidence: for every field, how sure you are (0 to 1). Be honest; low confidence is useful.',
  '- garment_count: how many separate garments are clearly visible. is_garment: false if the photo shows no',
  '  clothing, shoes or accessory at all.',
  'Menswear and womenswear are equally likely. Do not guess brand, size or the wearer\'s gender.',
].join('\n');

// ---------- Response schema (JSON Schema, for Gemini `responseJsonSchema`) ----------

const nullableEnum = (values: readonly (string | number)[], type: 'string' | 'integer' = 'string') => ({
  type: [type, 'null'],
  enum: [...values, null],
});
const enumArray = (values: readonly string[], maxItems: number) => ({
  type: 'array',
  items: { type: 'string', enum: [...values] },
  maxItems,
});
const unit = { type: 'number', minimum: 0, maximum: 1 };

export const TAGGING_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    is_garment: { type: 'boolean' },
    garment_count: { type: 'integer', minimum: 0 },
    category: nullableEnum(CATEGORY_IDS),
    subcategory: nullableEnum(SUBCATEGORIES),
    colours: enumArray(COLOUR_IDS, MAX_COLOURS),
    pattern: nullableEnum(PATTERNS),
    materials: enumArray(MATERIAL_IDS, MAX_MATERIALS),
    fit: nullableEnum(FITS),
    formality: nullableEnum(FORMALITY_IDS, 'integer'),
    seasons: enumArray(SEASONS, SEASONS.length),
    occasions: enumArray(OCCASIONS, OCCASIONS.length),
    confidence: {
      type: 'object',
      properties: Object.fromEntries(TAG_FIELDS.map((f) => [f, unit])),
      required: [...TAG_FIELDS],
    },
  },
  required: ['is_garment', 'garment_count', ...TAG_FIELDS, 'confidence'],
} as const;

// ---------- Validation ----------

const ALIASES: Record<string, string> = {
  gray: 'grey', dark_grey: 'charcoal', cream: 'off_white', ecru: 'off_white', tan: 'camel', khaki: 'beige',
  maroon: 'burgundy', denim: 'denim_blue', jewelry: 'jewellery', tshirt: 't_shirt', tee: 't_shirt',
  sweater: 'knit', jumper: 'knit', color_block: 'colour_block', plaid: 'check', tartan: 'check',
  striped: 'stripe', stripes: 'stripe', checked: 'check', polka_dots: 'polka_dot', onepiece: 'one_piece',
  shoes: 'footwear', fall: 'autumn',
};

/** "Off-White " → "off_white"; known synonyms map to the taxonomy id. */
export function normaliseId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!id) return null;
  return ALIASES[id] ?? id;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const id = normaliseId(value);
  return id !== null && (allowed as readonly string[]).includes(id) ? (id as T) : null;
}

function pickMany<T extends string>(value: unknown, allowed: readonly T[], max?: number): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const v of value) {
    const id = pick(v, allowed);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return max === undefined ? out : out.slice(0, max);
}

function pickFormality(value: unknown): Formality | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && (FORMALITY_IDS as number[]).includes(n) ? (n as Formality) : null;
}

function clampConfidence(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || Number.isNaN(n)) return undefined;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

function isEmpty(v: ItemTags[TagField]): boolean {
  return v === null || (Array.isArray(v) && v.length === 0);
}

const EMPTY: Record<TagField, ItemTags[TagField]> = {
  category: null, subcategory: null, colours: [], pattern: null, materials: [], fit: null, formality: null,
  seasons: [], occasions: [],
};

/**
 * Turns the model's reply (parsed JSON or the raw JSON string) into tags that satisfy the clothing_items
 * constraints. Never throws: a broken reply comes back as { ok: false, reason: 'invalid_response' } so the app can
 * fall back to manual tagging.
 */
export function parseTaggingResponse(raw: unknown): TaggingResult {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'invalid_response', message: 'The AI reply was not valid JSON.' };
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'invalid_response', message: 'The AI reply was not an object.' };
  }
  const r = data as Record<string, unknown>;

  if (r.is_garment === false) {
    return {
      ok: false,
      reason: 'not_garment',
      message: "We couldn't find a piece of clothing in this photo. Try a closer shot of one item.",
    };
  }

  const warnings: TaggingWarning[] = [];
  let category = pick(r.category, CATEGORY_IDS);
  let subcategory = pick(r.subcategory, SUBCATEGORIES);
  if (subcategory !== null) {
    const expected = categoryOf(subcategory);
    if (category === null) category = expected;
    else if (category !== expected) {
      // The two guesses disagree (e.g. category "top" + "jeans"): keep the broad one, let the user pick the rest.
      warnings.push('subcategory_mismatch');
      subcategory = null;
    }
  }

  const tags: ItemTags = {
    category,
    subcategory,
    colours: pickMany(r.colours, COLOUR_IDS, MAX_COLOURS),
    pattern: pick(r.pattern, PATTERNS),
    materials: pickMany(r.materials, MATERIAL_IDS, MAX_MATERIALS),
    fit: pick(r.fit, FITS),
    formality: pickFormality(r.formality),
    seasons: pickMany(r.seasons, SEASONS),
    occasions: pickMany(r.occasions, OCCASIONS),
  };

  const rawConfidence =
    typeof r.confidence === 'object' && r.confidence !== null ? (r.confidence as Record<string, unknown>) : {};
  const confidence: Partial<Record<TagField, number>> = {};
  const needsCheck: TagField[] = [];
  for (const field of TAG_FIELDS) {
    const c = clampConfidence(rawConfidence[field]);
    if (c !== undefined) confidence[field] = c;
    if (c !== undefined && c < DROP_THRESHOLD && !isEmpty(tags[field])) {
      (tags as unknown as Record<TagField, ItemTags[TagField]>)[field] = EMPTY[field];
    }
    // Category and colours drive matching, so they're flagged when missing. Other empty fields are fine
    // (empty seasons = all-season).
    const required = field === 'category' || field === 'colours';
    const unsure = c === undefined || c < CHECK_THRESHOLD;
    if ((required && isEmpty(tags[field])) || (unsure && !isEmpty(tags[field]))) needsCheck.push(field);
  }
  // A dropped category takes its subcategory with it.
  if (tags.category === null) tags.subcategory = null;

  if (typeof r.garment_count === 'number' && r.garment_count > 1) warnings.push('multiple_garments');

  return { ok: true, tags, confidence, needsCheck, warnings };
}

/** Columns the server writes on clothing_items after tagging (tags stay unconfirmed until the user saves). */
export function toItemColumns(result: Extract<TaggingResult, { ok: true }>, model: string) {
  return {
    ...result.tags,
    tag_confidence: { model, fields: result.confidence, suggested: result.tags },
  };
}
