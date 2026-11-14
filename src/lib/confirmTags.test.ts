import { describe, expect, it } from 'vitest';
import {
  EMPTY_TAGS,
  atLimit,
  limitMessage,
  orderBadge,
  TAG_ERROR_COPY,
  fieldStatus,
  formFromColumns,
  formalityLabel,
  initialForm,
  missingFields,
  missingMessage,
  setCategory,
  setSingle,
  setSubcategory,
  subcategoryOptions,
  suggestionFromResponse,
  suggestionFromStored,
  tagErrorKind,
  tagLabel,
  toConfirmedUpdate,
  toggleValue,
} from './confirmTags';
import { TAG_FIELDS, parseTaggingResponse, toItemColumns, type ItemTags } from './tagging';
import { CATEGORIES } from './taxonomy';

const sure = Object.fromEntries(TAG_FIELDS.map((f) => [f, 0.9]));

const coat: ItemTags = {
  category: 'outerwear',
  subcategory: 'coat',
  colours: ['camel', 'black'],
  pattern: 'solid',
  materials: ['wool'],
  fit: 'regular',
  formality: 4,
  seasons: ['autumn', 'winter'],
  occasions: ['work'],
};

function tagged(tags: unknown, confidence: Record<string, number>, warnings: string[] = []) {
  return { status: 'tagged', tags, confidence, needs_check: [], warnings };
}

function aiForm(tags: unknown, confidence: Record<string, number>, warnings: string[] = []) {
  const s = suggestionFromResponse(tagged(tags, confidence, warnings));
  if (!s) throw new Error('expected a suggestion');
  return initialForm(s);
}

describe('suggestionFromResponse', () => {
  it('reads a fresh tag-item reply', () => {
    const s = suggestionFromResponse(tagged(coat, sure));
    expect(s?.tags).toEqual(coat);
    expect(s?.needsCheck).toEqual([]);
  });

  it('reads an already_tagged reply from the stored tag_confidence', () => {
    const parsed = parseTaggingResponse({ ...coat, is_garment: true, confidence: { ...sure, pattern: 0.4 } });
    if (!parsed.ok) throw new Error('expected ok');
    const { tag_confidence } = toItemColumns(parsed, 'model-x');
    const s = suggestionFromResponse({ status: 'already_tagged', tag_confidence });
    expect(s?.tags).toEqual(coat);
    expect(s?.needsCheck).toEqual(['pattern']);
    expect(suggestionFromStored(tag_confidence)).toEqual(s);
  });

  it('keeps the category flagged when the server resolved a subcategory mismatch', () => {
    const s = suggestionFromResponse(tagged(coat, sure, ['subcategory_mismatch', 'bogus']));
    expect(s?.needsCheck).toEqual(['category']);
    expect(s?.warnings).toEqual(['subcategory_mismatch']);
  });

  it('drops values outside the taxonomy instead of showing them', () => {
    const s = suggestionFromResponse(tagged({ ...coat, colours: ['camel', 'sparkly'], fit: 'baggy' }, sure));
    expect(s?.tags.colours).toEqual(['camel']);
    expect(s?.tags.fit).toBeNull();
  });

  it('returns null for replies without tags', () => {
    expect(suggestionFromResponse(null)).toBeNull();
    expect(suggestionFromResponse({ error: 'ai_unavailable' })).toBeNull();
    expect(suggestionFromResponse({ status: 'tagged' })).toBeNull();
    expect(suggestionFromStored(null)).toBeNull();
    expect(suggestionFromStored({ fields: {} })).toBeNull();
  });
});

describe('tagErrorKind', () => {
  it('maps tag-item error codes', () => {
    expect(tagErrorKind({ error: 'needs_face_consent', message: 'x' })).toBe('needs_face_consent');
    expect(tagErrorKind({ error: 'daily_limit_reached' })).toBe('daily_limit');
    expect(tagErrorKind({ error: 'not_garment' })).toBe('not_garment');
    expect(tagErrorKind({ error: 'already_confirmed' })).toBe('already_confirmed');
    for (const error of ['ai_not_configured', 'no_photo', 'photo_unavailable']) {
      expect(tagErrorKind({ error })).toBe('not_available');
    }
    expect(TAG_ERROR_COPY.not_available.canRetry).toBe(false);
  });

  it('treats everything else (network, AI down, broken reply) as retryable', () => {
    for (const body of [undefined, null, 'oops', { error: 'ai_unavailable' }, { error: 'invalid_response' }]) {
      expect(tagErrorKind(body)).toBe('unavailable');
    }
    expect(TAG_ERROR_COPY.unavailable.canRetry).toBe(true);
    expect(TAG_ERROR_COPY.needs_face_consent.canRetry).toBe(false);
  });

  it('never shows raw error codes', () => {
    for (const { message } of Object.values(TAG_ERROR_COPY)) expect(message).not.toMatch(/_/);
  });
});

describe('fieldStatus', () => {
  it('marks low-confidence guesses as "check" and dropped or missing ones as "pick"', () => {
    const form = aiForm(coat, { ...sure, pattern: 0.5, materials: 0.2, colours: 0.1 });
    expect(fieldStatus(form, 'pattern')).toBe('check');
    expect(form.tags.materials).toEqual([]);
    expect(fieldStatus(form, 'materials')).toBe('pick'); // dropped below 0.3
    expect(fieldStatus(form, 'colours')).toBe('pick'); // dropped and required
    expect(fieldStatus(form, 'fit')).toBe('ok');
  });

  it('never asks to pick seasons (empty means all year)', () => {
    const form = aiForm({ ...coat, seasons: [] }, { ...sure, seasons: 0.1 });
    expect(fieldStatus(form, 'seasons')).toBe('ok');
  });

  it('asks to pick a missing category even when the AI was sure', () => {
    const form = aiForm({ ...coat, category: null, subcategory: null }, sure);
    expect(fieldStatus(form, 'category')).toBe('pick');
  });

  it('clears the highlight once the user touches the field', () => {
    let form = aiForm(coat, { ...sure, pattern: 0.5 });
    form = setSingle(form, 'pattern', 'solid');
    expect(fieldStatus(form, 'pattern')).toBe('ok');
  });

  it('shows no highlights in the manual and confirmed forms', () => {
    for (const form of [initialForm(null), formFromColumns(coat)]) {
      for (const f of TAG_FIELDS) expect(fieldStatus(form, f)).toBe('ok');
    }
  });
});

describe('editing', () => {
  it('a subcategory sets its category', () => {
    const form = setSubcategory(initialForm(null), 'blazer');
    expect(form.tags.category).toBe('outerwear');
    expect(form.touched).toEqual(['subcategory', 'category']);
  });

  it('changing the category clears a subcategory from another category', () => {
    const form = setCategory(formFromColumns(coat), 'top');
    expect(form.tags).toMatchObject({ category: 'top', subcategory: null });
    expect(setCategory(formFromColumns(coat), 'outerwear').tags.subcategory).toBe('coat');
  });

  it('asks to pick the type again after a new category cleared it', () => {
    let form = setCategory(aiForm(coat, sure), 'top');
    expect(fieldStatus(form, 'subcategory')).toBe('pick');
    form = setSubcategory(form, 'knit');
    expect(fieldStatus(form, 'subcategory')).toBe('ok');
    expect(fieldStatus(setCategory(formFromColumns(coat), 'bottom'), 'subcategory')).toBe('pick');
    expect(fieldStatus(setCategory(initialForm(null), 'top'), 'subcategory')).toBe('ok');
  });

  it('clearing the subcategory keeps the category', () => {
    expect(setSubcategory(formFromColumns(coat), null).tags).toMatchObject({ category: 'outerwear', subcategory: null });
  });

  it('toggles colours in tap order, up to 3', () => {
    let form = initialForm(null);
    for (const c of ['navy', 'white', 'red', 'green'] as const) form = toggleValue(form, 'colours', c);
    expect(form.tags.colours).toEqual(['navy', 'white', 'red']);
    form = toggleValue(form, 'colours', 'navy');
    expect(form.tags.colours).toEqual(['white', 'red']);
  });

  it('knows when a multi-choice field is full and which value is the main one', () => {
    const form = formFromColumns({ ...coat, colours: ['navy', 'white', 'red'] });
    expect(atLimit(form, 'colours', 'green')).toBe(true);
    expect(atLimit(form, 'colours', 'navy')).toBe(false); // tapping a selected one removes it
    expect(limitMessage('colours')).toBe('You can pick up to 3. Tap one to remove it.');
    expect(orderBadge(form.tags.colours, 'navy')).toBe('Main');
    expect(orderBadge(form.tags.colours, 'white')).toBeUndefined();
    expect(orderBadge(['navy'], 'navy')).toBeUndefined();
  });

  it('does not mutate the previous state or the suggestion', () => {
    const before = aiForm(coat, sure);
    const after = toggleValue(before, 'colours', 'navy');
    expect(before.tags.colours).toEqual(['camel', 'black']);
    expect(before.suggestion?.tags.colours).toEqual(['camel', 'black']);
    expect(after.tags.colours).toEqual(['camel', 'black', 'navy']);
  });
});

describe('saving', () => {
  it('requires a category and a colour', () => {
    expect(missingFields(EMPTY_TAGS)).toEqual(['category', 'colours']);
    expect(missingFields(coat)).toEqual([]);
    expect(missingMessage([])).toBeNull();
    expect(missingMessage(['colours'])).toMatch(/colour/);
    expect(missingMessage(['category', 'colours'])).toMatch(/category and at least one colour/);
  });

  it('writes every tag column plus tags_confirmed_at', () => {
    const now = new Date('2026-11-14T10:00:00Z');
    expect(toConfirmedUpdate(coat, now)).toEqual({ ...coat, tags_confirmed_at: '2026-11-14T10:00:00.000Z' });
  });

  it('keeps the payload inside the database constraints', () => {
    const messy = {
      ...coat,
      category: 'top',
      colours: ['navy', 'navy', 'white', 'red', 'green'],
      materials: ['wool', 'plastic'],
    } as unknown as ItemTags;
    const update = toConfirmedUpdate(messy);
    expect(update.category).toBe('outerwear'); // follows the subcategory
    expect(update.colours).toEqual(['navy', 'white', 'red']);
    expect(update.materials).toEqual(['wool']);
  });
});

describe('labels', () => {
  it('turns ids into readable English', () => {
    expect(tagLabel('denim_blue')).toBe('Denim blue');
    expect(tagLabel('t_shirt')).toBe('T-shirt');
    expect(tagLabel('off_white')).toBe('Off-white');
    expect(formalityLabel(3)).toBe('Smart casual');
  });

  it('offers the subcategories of the chosen category', () => {
    expect(subcategoryOptions('footwear')).toEqual(CATEGORIES.footwear);
    expect(subcategoryOptions(null)).toContain('dress');
  });
});
