import { describe, expect, it } from 'vitest';
import { CATEGORIES, COLOURS, MATERIALS, PATTERNS } from './taxonomy';
import {
  MAX_COLOURS,
  TAGGING_PROMPT,
  TAGGING_RESPONSE_SCHEMA,
  TAG_FIELDS,
  normaliseId,
  parseTaggingResponse,
  toItemColumns,
} from './tagging';

const sure = Object.fromEntries(TAG_FIELDS.map((f) => [f, 0.9]));

const good = {
  is_garment: true,
  garment_count: 1,
  category: 'outerwear',
  subcategory: 'coat',
  colours: ['camel', 'black'],
  pattern: 'solid',
  materials: ['wool'],
  fit: 'regular',
  formality: 4,
  seasons: ['autumn', 'winter'],
  occasions: ['work', 'everyday'],
  confidence: sure,
};

function ok(raw: unknown) {
  const r = parseTaggingResponse(raw);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r;
}

describe('response schema', () => {
  it('lists every taxonomy value, so the model can only answer with valid ids', () => {
    const p = TAGGING_RESPONSE_SCHEMA.properties;
    expect(p.subcategory.enum).toEqual([...Object.values(CATEGORIES).flat(), null]);
    expect(p.colours.items.enum).toEqual(Object.keys(COLOURS));
    expect(p.materials.items.enum).toEqual(Object.keys(MATERIALS));
    expect(p.pattern.enum).toEqual([...PATTERNS, null]);
    expect(p.formality.enum).toEqual([1, 2, 3, 4, 5, null]);
    expect(p.colours.maxItems).toBe(MAX_COLOURS);
  });

  it('requires a confidence for every tag field', () => {
    expect(TAGGING_RESPONSE_SCHEMA.properties.confidence.required).toEqual([...TAG_FIELDS]);
    expect(TAGGING_RESPONSE_SCHEMA.required).toEqual(expect.arrayContaining([...TAG_FIELDS, 'confidence']));
  });

  it('is plain JSON (serialisable for the API call)', () => {
    expect(JSON.parse(JSON.stringify(TAGGING_RESPONSE_SCHEMA))).toEqual(TAGGING_RESPONSE_SCHEMA);
  });

  it('prompt covers both menswear and womenswear and explains formality', () => {
    expect(TAGGING_PROMPT).toMatch(/Menswear and womenswear/);
    expect(TAGGING_PROMPT).toMatch(/3 = smart casual/);
  });
});

describe('parseTaggingResponse', () => {
  it('accepts a clean reply as-is, nothing to check', () => {
    const r = ok(good);
    expect(r.tags).toEqual({
      category: 'outerwear', subcategory: 'coat', colours: ['camel', 'black'], pattern: 'solid',
      materials: ['wool'], fit: 'regular', formality: 4, seasons: ['autumn', 'winter'],
      occasions: ['work', 'everyday'],
    });
    expect(r.needsCheck).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('parses a raw JSON string', () => {
    expect(ok(JSON.stringify(good)).tags.subcategory).toBe('coat');
  });

  it('rejects broken replies without throwing', () => {
    for (const raw of ['{not json', null, 42, [good]]) {
      const r = parseTaggingResponse(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_response');
    }
  });

  it('reports "not a garment" with a friendly English message', () => {
    const r = parseTaggingResponse({ ...good, is_garment: false });
    expect(r).toMatchObject({ ok: false, reason: 'not_garment' });
  });

  it('normalises casing, spaces, hyphens and common synonyms', () => {
    expect(normaliseId(' Off-White ')).toBe('off_white');
    expect(normaliseId('Gray', 'colour')).toBe('grey');
    expect(normaliseId('T-Shirt', 'subcategory')).toBe('t_shirt');
    expect(normaliseId('fall', 'season')).toBe('autumn');
    expect(normaliseId('denim', 'material')).toBe('denim');
    const r = ok({ ...good, category: 'Top', subcategory: 'Sweater', colours: ['Navy', 'cream'], pattern: 'Plaid' });
    expect(r.tags).toMatchObject({ category: 'top', subcategory: 'knit', colours: ['navy', 'off_white'], pattern: 'check' });
  });

  it('drops unknown values and duplicates, and caps colours at 3 (DB constraint)', () => {
    const r = ok({ ...good, colours: ['neon', 'black', 'Black', 'white', 'navy', 'grey'], materials: ['vibranium', 'wool'] });
    expect(r.tags.colours).toEqual(['black', 'white', 'navy']);
    expect(r.tags.materials).toEqual(['wool']);
  });

  it('fills the category from the subcategory', () => {
    expect(ok({ ...good, category: null }).tags.category).toBe('outerwear');
  });

  it('trusts the subcategory when it contradicts the category, and flags the category', () => {
    const r = ok({ ...good, category: 'top', subcategory: 'overshirt' });
    expect(r.tags).toMatchObject({ category: 'outerwear', subcategory: 'overshirt' });
    expect(r.warnings).toContain('subcategory_mismatch');
    expect(r.needsCheck).toEqual(['category']);
  });

  it('keeps "denim" as a material and maps it to denim_blue only as a colour', () => {
    const r = ok({ ...good, category: 'bottom', subcategory: 'jeans', colours: ['denim'], materials: ['Denim'] });
    expect(r.tags.colours).toEqual(['denim_blue']);
    expect(r.tags.materials).toEqual(['denim']);
  });

  it('a weak category does not wipe out a confident subcategory', () => {
    const r = ok({ ...good, category: 'top', confidence: { ...sure, category: 0.1 } });
    expect(r.tags).toMatchObject({ category: 'outerwear', subcategory: 'coat' });
    expect(r.needsCheck).not.toContain('category');
  });

  it('never clears a weak season guess (empty would mean all-season), only flags it', () => {
    const r = ok({ ...good, subcategory: 'parka', seasons: ['winter'], confidence: { ...sure, seasons: 0.1 } });
    expect(r.tags.seasons).toEqual(['winter']);
    expect(r.needsCheck).toEqual(['seasons']);
  });

  it('accepts formality as a number or numeric string, rejects out-of-range', () => {
    expect(ok({ ...good, formality: '2' }).tags.formality).toBe(2);
    expect(ok({ ...good, formality: 6 }).tags.formality).toBeNull();
    expect(ok({ ...good, formality: 2.5 }).tags.formality).toBeNull();
  });

  it('flags fields under 0.6 confidence as "check this"', () => {
    const r = ok({ ...good, confidence: { ...sure, materials: 0.5, fit: 0.59 } });
    expect(r.needsCheck).toEqual(['materials', 'fit']);
    expect(r.tags.materials).toEqual(['wool']); // still prefilled
  });

  it('drops guesses under 0.3 confidence', () => {
    const r = ok({ ...good, confidence: { ...sure, category: 0.2, subcategory: 0.2, fit: 0.1 } });
    expect(r.tags.category).toBeNull();
    expect(r.tags.subcategory).toBeNull();
    expect(r.tags.fit).toBeNull();
    expect(r.needsCheck).toContain('category');
    expect(r.needsCheck).not.toContain('fit'); // empty optional field: nothing to check
  });

  it('always asks the user for category and colours when missing', () => {
    const r = ok({ ...good, category: null, subcategory: null, colours: [] });
    expect(r.needsCheck).toEqual(expect.arrayContaining(['category', 'colours']));
  });

  it('treats a missing confidence as unsure', () => {
    const r = ok({ ...good, confidence: undefined });
    expect(r.needsCheck).toEqual([...TAG_FIELDS]);
    expect(r.confidence).toEqual({});
  });

  it('clamps confidences to 0–1', () => {
    const r = ok({ ...good, confidence: { ...sure, pattern: 7, fit: -1 } });
    expect(r.confidence.pattern).toBe(1);
    expect(r.confidence.fit).toBe(0);
  });

  it('warns when the photo shows several garments', () => {
    expect(ok({ ...good, garment_count: 3 }).warnings).toEqual(['multiple_garments']);
  });

  it('empty seasons stay empty (all-season) and are not flagged', () => {
    const r = ok({ ...good, seasons: [], confidence: { ...sure, seasons: 0.4 } });
    expect(r.tags.seasons).toEqual([]);
    expect(r.needsCheck).not.toContain('seasons');
  });
});

describe('toItemColumns', () => {
  it('maps to clothing_items columns and keeps the AI suggestion for measuring corrections', () => {
    const cols = toItemColumns(ok(good), 'gemini-3.5-flash-lite');
    expect(cols).toMatchObject({ category: 'outerwear', subcategory: 'coat', formality: 4 });
    expect(cols.tag_confidence).toMatchObject({
      schema_version: 1, model: 'gemini-3.5-flash-lite', fields: { category: 0.9 }, warnings: [],
    });
    expect(cols.tag_confidence.suggested.colours).toEqual(['camel', 'black']);
  });
});
