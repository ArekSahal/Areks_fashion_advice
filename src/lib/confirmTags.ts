/**
 * Confirm-tags screen logic (M1c-5, issue #39). Pure TypeScript so it can be unit tested:
 * tag-item response → suggestion → form state → clothing_items update.
 *
 * Unconfirmed AI tags are never facts (docs/design-system.md): the form starts from the suggestion, fields the
 * validator flagged are marked "check this", weak guesses it dropped ask the user to pick, and only Save writes
 * the tags together with tags_confirmed_at.
 */
import {
  DROP_THRESHOLD,
  MAX_COLOURS,
  MAX_MATERIALS,
  TAG_FIELDS,
  parseTaggingResponse,
  type ItemTags,
  type TagField,
  type TaggingWarning,
} from './tagging.ts';
import {
  CATEGORIES,
  COLOURS,
  FITS,
  FORMALITY,
  MATERIALS,
  OCCASIONS,
  PATTERNS,
  SEASONS,
  categoryOf,
  type Category,
  type Formality,
  type Subcategory,
} from './taxonomy.ts';

export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];
const SUBCATEGORIES = Object.values(CATEGORIES).flat() as Subcategory[];
const COLOUR_IDS = Object.keys(COLOURS);
const MATERIAL_IDS = Object.keys(MATERIALS);
export const FORMALITY_IDS = Object.keys(FORMALITY).map(Number) as Formality[];

/** What the AI suggested, after validation. */
export type Suggestion = {
  tags: ItemTags;
  confidence: Partial<Record<TagField, number>>;
  /** Fields to highlight ("check this", or "pick one" when empty). */
  needsCheck: TagField[];
  warnings: TaggingWarning[];
};

/** Where the form's starting values came from. */
export type FormSource = 'ai' | 'manual' | 'confirmed';

export type TagForm = {
  tags: ItemTags;
  source: FormSource;
  suggestion: Suggestion | null;
  /** Fields the user changed; their highlight goes away. */
  touched: TagField[];
};

export type FieldStatus = 'ok' | 'check' | 'pick';

type MultiField = 'colours' | 'materials' | 'seasons' | 'occasions';
type SingleField = 'pattern' | 'fit' | 'formality';

export const MAX_SELECTED: Record<MultiField, number> = {
  colours: MAX_COLOURS,
  materials: MAX_MATERIALS,
  seasons: SEASONS.length,
  occasions: OCCASIONS.length,
};

/** Fields that must be filled before saving: they drive matching (category slot, colour harmony). */
export const REQUIRED_FIELDS = ['category', 'colours'] as const satisfies readonly TagField[];

export const EMPTY_TAGS: ItemTags = {
  category: null,
  subcategory: null,
  colours: [],
  pattern: null,
  materials: [],
  fit: null,
  formality: null,
  seasons: [],
  occasions: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEmpty(v: ItemTags[TagField]): boolean {
  return v === null || (Array.isArray(v) && v.length === 0);
}

const WARNINGS: readonly TaggingWarning[] = ['multiple_garments', 'subcategory_mismatch'];

/**
 * Re-validates stored or returned tags with the same validator tag-item uses, so the screen never shows a value
 * outside the taxonomy, and recomputes which fields need checking. A subcategory/category mismatch was already
 * resolved on the server (the category now matches the subcategory), so its warning is carried over explicitly.
 */
function toSuggestion(tags: unknown, confidence: unknown, warnings: unknown): Suggestion | null {
  if (!isRecord(tags)) return null;
  const parsed = parseTaggingResponse({ ...tags, is_garment: true, confidence: isRecord(confidence) ? confidence : {} });
  if (!parsed.ok) return null;
  const w = Array.isArray(warnings) ? WARNINGS.filter((x) => warnings.includes(x)) : [];
  const needsCheck = new Set<TagField>(parsed.needsCheck);
  if (w.includes('subcategory_mismatch')) needsCheck.add('category');
  return {
    tags: parsed.tags,
    confidence: parsed.confidence,
    needsCheck: TAG_FIELDS.filter((f) => needsCheck.has(f)),
    warnings: w,
  };
}

/**
 * The suggestion from a successful tag-item reply: `{ status: 'tagged', tags, confidence, warnings }` or
 * `{ status: 'already_tagged', tag_confidence }`. Null if the reply has no usable tags.
 */
export function suggestionFromResponse(body: unknown): Suggestion | null {
  if (!isRecord(body)) return null;
  if (body.status === 'tagged') return toSuggestion(body.tags, body.confidence, body.warnings);
  if (body.status === 'already_tagged') return suggestionFromStored(body.tag_confidence);
  return null;
}

/** The suggestion stored in clothing_items.tag_confidence (written by tag-item), or null if none. */
export function suggestionFromStored(tagConfidence: unknown): Suggestion | null {
  if (!isRecord(tagConfidence)) return null;
  return toSuggestion(tagConfidence.suggested, tagConfidence.fields, tagConfidence.warnings);
}

/** What went wrong when asking tag-item for suggestions, as far as the screen cares. */
export type TagErrorKind = 'needs_face_consent' | 'daily_limit' | 'not_garment' | 'already_confirmed' | 'unavailable';

/** Maps a tag-item error body (`{ error: '...' }`, or nothing on a network error) to what the screen shows. */
export function tagErrorKind(body: unknown): TagErrorKind {
  const code = isRecord(body) ? body.error : undefined;
  switch (code) {
    case 'needs_face_consent':
      return 'needs_face_consent';
    case 'daily_limit_reached':
      return 'daily_limit';
    case 'not_garment':
      return 'not_garment';
    case 'already_confirmed':
      return 'already_confirmed';
    default:
      return 'unavailable';
  }
}

/** Plain-words explanation per error, and whether "Try again" can help. Never shows raw codes. */
export const TAG_ERROR_COPY: Record<Exclude<TagErrorKind, 'already_confirmed'>, { message: string; canRetry: boolean }> = {
  needs_face_consent: {
    message:
      'To keep faces private, we only send photos to the AI after faces are blurred, and that step isn’t ready yet. ' +
      'You can tag this one yourself, or turn on “Let AI see faces” in Profile.',
    canRetry: false,
  },
  daily_limit: {
    message: 'You’ve used today’s tag suggestions. You can tag this one yourself, or come back tomorrow.',
    canRetry: false,
  },
  not_garment: {
    message: 'We couldn’t spot a piece of clothing in this photo. You can tag it yourself.',
    canRetry: false,
  },
  unavailable: {
    message: 'We couldn’t get tag suggestions right now. Try again, or tag it yourself.',
    canRetry: true,
  },
};

/** Starts the form from an AI suggestion (fields highlighted where needed) or empty for "Tag it myself". */
export function initialForm(suggestion: Suggestion | null): TagForm {
  return suggestion
    ? { tags: cloneTags(suggestion.tags), source: 'ai', suggestion, touched: [] }
    : { tags: cloneTags(EMPTY_TAGS), source: 'manual', suggestion: null, touched: [] };
}

/** Tag columns of an existing item (already confirmed): no highlights, the user just edits. */
export type TagColumns = { [K in keyof ItemTags]?: ItemTags[K] | null };

export function formFromColumns(row: TagColumns): TagForm {
  const tags: ItemTags = {
    category: row.category ?? null,
    subcategory: row.subcategory ?? null,
    colours: [...(row.colours ?? [])],
    pattern: row.pattern ?? null,
    materials: [...(row.materials ?? [])],
    fit: row.fit ?? null,
    formality: row.formality ?? null,
    seasons: [...(row.seasons ?? [])],
    occasions: [...(row.occasions ?? [])],
  };
  return { tags, source: 'confirmed', suggestion: null, touched: [] };
}

function cloneTags(t: ItemTags): ItemTags {
  return {
    ...t,
    colours: [...t.colours],
    materials: [...t.materials],
    seasons: [...t.seasons],
    occasions: [...t.occasions],
  };
}

/**
 * How a field is shown: 'check' = AI guess the validator flagged (confidence < 0.6), 'pick' = empty and the user
 * should choose (required, or the guess was dropped below 0.3), 'ok' = nothing to point out.
 * Once the user touches a field it is theirs and shows as 'ok'.
 */
export function fieldStatus(form: TagForm, field: TagField): FieldStatus {
  const s = form.suggestion;
  if (!s || form.touched.includes(field)) return 'ok';
  const flagged = s.needsCheck.includes(field);
  if (isEmpty(form.tags[field])) {
    const c = s.confidence[field];
    // Empty seasons means "all year", which is a real answer, so it's never a "pick one".
    const dropped = c !== undefined && c < DROP_THRESHOLD && field !== 'seasons';
    return flagged || dropped ? 'pick' : 'ok';
  }
  return flagged ? 'check' : 'ok';
}

function touch(form: TagForm, ...fields: TagField[]): TagField[] {
  const out = [...form.touched];
  for (const f of fields) if (!out.includes(f)) out.push(f);
  return out;
}

/** Picking a category clears a subcategory that doesn't belong to it. */
export function setCategory(form: TagForm, category: Category | null): TagForm {
  const sub = form.tags.subcategory;
  const keepSub = sub !== null && category !== null && categoryOf(sub) === category;
  return {
    ...form,
    tags: { ...form.tags, category, subcategory: keepSub ? sub : null },
    touched: touch(form, 'category'),
  };
}

/** Picking a subcategory also sets its category (a coat is always outerwear). Clearing it keeps the category. */
export function setSubcategory(form: TagForm, subcategory: Subcategory | null): TagForm {
  if (subcategory === null) {
    return { ...form, tags: { ...form.tags, subcategory: null }, touched: touch(form, 'subcategory') };
  }
  return {
    ...form,
    tags: { ...form.tags, subcategory, category: categoryOf(subcategory) },
    touched: touch(form, 'subcategory', 'category'),
  };
}

export function setSingle<F extends SingleField>(form: TagForm, field: F, value: ItemTags[F]): TagForm {
  return { ...form, tags: { ...form.tags, [field]: value }, touched: touch(form, field) };
}

/**
 * Adds or removes one value of a multi-choice field, in tap order (the first colour is the dominant one).
 * At the maximum, a new value is ignored; the screen's hint explains the limit.
 */
export function toggleValue<F extends MultiField>(form: TagForm, field: F, value: ItemTags[F][number]): TagForm {
  const current = form.tags[field] as readonly string[];
  const v = value as string;
  let next: string[];
  if (current.includes(v)) next = current.filter((x) => x !== v);
  else if (current.length < MAX_SELECTED[field]) next = [...current, v];
  else return form;
  return { ...form, tags: { ...form.tags, [field]: next }, touched: touch(form, field) };
}

/** Required fields still empty, in display order. */
export function missingFields(tags: ItemTags): TagField[] {
  return REQUIRED_FIELDS.filter((f) => isEmpty(tags[f]));
}

export function missingMessage(missing: readonly TagField[]): string | null {
  if (missing.length === 0) return null;
  if (missing.length === 2) return 'Pick a category and at least one colour to save.';
  return missing[0] === 'category' ? 'Pick a category to save.' : 'Pick at least one colour to save.';
}

/**
 * The clothing_items update for Save: every tag column (all client-writable per the column grants) plus
 * tags_confirmed_at. Values are filtered to the taxonomy and limits so the check constraints always pass.
 * The AI's original suggestion stays in tag_confidence.suggested, so corrections can be measured later.
 */
export function toConfirmedUpdate(tags: ItemTags, now: Date = new Date()) {
  const subcategory =
    tags.subcategory !== null && SUBCATEGORIES.includes(tags.subcategory) ? tags.subcategory : null;
  const category =
    subcategory !== null
      ? categoryOf(subcategory)
      : tags.category !== null && CATEGORY_IDS.includes(tags.category)
        ? tags.category
        : null;
  const only = <T extends string>(values: readonly T[], allowed: readonly string[], max: number): T[] =>
    values.filter((v, i) => allowed.includes(v) && values.indexOf(v) === i).slice(0, max);
  return {
    category,
    subcategory,
    colours: only(tags.colours, COLOUR_IDS, MAX_COLOURS),
    pattern: tags.pattern !== null && (PATTERNS as readonly string[]).includes(tags.pattern) ? tags.pattern : null,
    materials: only(tags.materials, MATERIAL_IDS, MAX_MATERIALS),
    fit: tags.fit !== null && (FITS as readonly string[]).includes(tags.fit) ? tags.fit : null,
    formality: tags.formality !== null && FORMALITY_IDS.includes(tags.formality) ? tags.formality : null,
    seasons: only(tags.seasons, SEASONS, SEASONS.length),
    occasions: only(tags.occasions, OCCASIONS, OCCASIONS.length),
    tags_confirmed_at: now.toISOString(),
  };
}

export type ConfirmedUpdate = ReturnType<typeof toConfirmedUpdate>;

// ---------- Display ----------

const LABEL_OVERRIDES: Record<string, string> = {
  t_shirt: 'T-shirt',
  off_white: 'Off-white',
  one_piece: 'One-piece',
};

/** Display name for a taxonomy id: "denim_blue" → "Denim blue", "t_shirt" → "T-shirt". */
export function tagLabel(id: string): string {
  const override = LABEL_OVERRIDES[id];
  if (override) return override;
  const text = id.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formalityLabel(f: Formality): string {
  return tagLabel(FORMALITY[f]);
}

/** Subcategories offered for the chosen category (all of them, grouped, when no category is picked yet). */
export function subcategoryOptions(category: Category | null): readonly Subcategory[] {
  return category ? CATEGORIES[category] : SUBCATEGORIES;
}
