import { describe, expect, it } from 'vitest';
import {
  DETECTION_PROMPT,
  DETECTION_RESPONSE_SCHEMA,
  MAX_GARMENTS,
  boxIoU,
  boxToCropRect,
  buildDetectionRequest,
  isValidSourceBox,
  normaliseBox,
  parseDetectionResponse,
  unionBox,
} from './detection';
import { GARMENT_TAG_PROPERTIES, TAG_FIELDS, TAG_RULES, parseGarmentTags } from './tagging';
import { buildTaggingRequest } from './vertex';

const sure = Object.fromEntries(TAG_FIELDS.map((f) => [f, 0.9]));

function garment(box: unknown[], tags: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    box_2d: box,
    detection_confidence: 0.95,
    category: null, subcategory: null, colours: [], pattern: null, materials: [], fit: null, formality: null,
    seasons: [], occasions: [], confidence: sure,
    ...tags,
    ...extra,
  };
}

// Mirror selfie, menswear smart casual: overshirt, shirt, chinos, loafers.
const menswear = {
  garments: [
    garment([180, 250, 560, 760], { subcategory: 'overshirt', colours: ['olive'], pattern: 'solid', materials: ['cotton'], fit: 'relaxed', formality: 3, seasons: ['spring', 'autumn'], occasions: ['everyday'] }),
    garment([200, 380, 450, 620], { subcategory: 'shirt', colours: ['white'], pattern: 'stripe', materials: ['cotton'], fit: 'regular', formality: 3, occasions: ['work'] }),
    garment([540, 300, 900, 700], { subcategory: 'chinos', colours: ['beige'], pattern: 'solid', fit: 'slim', formality: 3, occasions: ['work', 'everyday'] }),
    garment([900, 280, 990, 720], { subcategory: 'loafers', colours: ['brown'], materials: ['suede'], formality: 3 }),
  ],
};

// Womenswear flat lay: dress, cardigan, heels, bag.
const womenswear = {
  garments: [
    garment([50, 300, 800, 700], { category: 'one_piece', subcategory: 'dress', colours: ['navy'], pattern: 'floral', materials: ['viscose'], fit: 'regular', formality: 3, seasons: ['summer'], occasions: ['party'] }),
    garment([60, 20, 500, 280], { subcategory: 'cardigan', colours: ['off_white'], pattern: 'knit_texture', materials: ['merino'], formality: 2 }),
    garment([820, 320, 980, 560], { subcategory: 'heels', colours: ['black'], materials: ['leather'], formality: 4, occasions: ['party', 'evening'] }),
    garment([600, 720, 900, 980], { subcategory: 'bag', colours: ['camel'], materials: ['leather'], formality: 3 }),
  ],
};

function ok(raw: unknown) {
  const r = parseDetectionResponse(raw);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r;
}

describe('detection schema and prompt', () => {
  it('reuses the tagging taxonomy for each garment', () => {
    const item = DETECTION_RESPONSE_SCHEMA.properties.garments.items;
    for (const [key, value] of Object.entries(GARMENT_TAG_PROPERTIES)) {
      expect(item.properties[key as keyof typeof item.properties]).toEqual(value);
    }
    expect(item.required).toEqual(expect.arrayContaining(['box_2d', 'detection_confidence', ...TAG_FIELDS, 'confidence']));
  });

  it('caps the list and asks for four 0–1000 integers per box', () => {
    const { garments } = DETECTION_RESPONSE_SCHEMA.properties;
    expect(garments.maxItems).toBe(MAX_GARMENTS);
    expect(garments.items.properties.box_2d).toMatchObject({ minItems: 4, maxItems: 4, items: { type: 'integer', maximum: 1000 } });
  });

  it('is plain JSON (serialisable for the API call)', () => {
    expect(JSON.parse(JSON.stringify(DETECTION_RESPONSE_SCHEMA))).toEqual(DETECTION_RESPONSE_SCHEMA);
  });

  it('prompt shares the tagging rules, covers both menswear and womenswear and keeps faces out of boxes', () => {
    for (const rule of TAG_RULES) expect(DETECTION_PROMPT).toContain(rule);
    expect(DETECTION_PROMPT).toMatch(/Menswear and womenswear/);
    expect(DETECTION_PROMPT).toMatch(/never the face/);
    expect(DETECTION_PROMPT).toMatch(/\[ymin, xmin, ymax, xmax\]/);
  });

  it('prompt asks for layered pieces separately and skips socks, underwear and hosiery', () => {
    expect(DETECTION_PROMPT).toMatch(/List layered pieces separately/);
    expect(DETECTION_PROMPT).toMatch(/Skip socks, underwear and hosiery/);
    expect(DETECTION_PROMPT).not.toMatch(/shoes, socks/);
  });

  it('request: detection prompt + schema, own billing label, larger output cap than tagging', () => {
    const req = buildDetectionRequest({ mimeType: 'image/jpeg', data: 'BBBB' });
    const tagging = buildTaggingRequest({ mimeType: 'image/jpeg', data: 'BBBB' });
    expect(req.contents[0]?.parts).toEqual([{ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }, { text: DETECTION_PROMPT }]);
    expect(req.generationConfig.responseJsonSchema).toBe(DETECTION_RESPONSE_SCHEMA);
    expect(req.generationConfig.temperature).toBe(tagging.generationConfig.temperature);
    expect(req.generationConfig.maxOutputTokens).toBeGreaterThan(tagging.generationConfig.maxOutputTokens);
    expect(req.generationConfig.maxOutputTokens).toBeLessThanOrEqual(4096);
    expect(req.labels).toEqual({ feature: 'detect_garments' });
    expect(tagging.labels).toEqual({ feature: 'tag_item' });
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });
});

describe('parseDetectionResponse', () => {
  it('menswear outfit: one garment per item with source_box-shaped boxes and tags', () => {
    const r = ok(menswear);
    expect(r.warnings).toEqual([]);
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['overshirt', 'shirt', 'chinos', 'loafers']);
    expect(r.garments.map((g) => g.tags.category)).toEqual(['outerwear', 'top', 'bottom', 'footwear']);
    expect(r.garments[0]?.box).toEqual({ x: 0.25, y: 0.18, w: 0.51, h: 0.38 });
    for (const g of r.garments) {
      expect(isValidSourceBox(g.box)).toBe(true);
      expect(g.uncertain).toBe(false);
      expect(g.needsCheck).toEqual([]);
    }
  });

  it('womenswear flat lay: dress, cardigan, heels and bag', () => {
    const r = ok(JSON.stringify(womenswear));
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['dress', 'cardigan', 'heels', 'bag']);
    expect(r.garments[0]?.tags).toMatchObject({ category: 'one_piece', pattern: 'floral', seasons: ['summer'] });
    expect(r.garments[3]?.tags.category).toBe('accessory');
  });

  it('uses the shared per-garment parser (same tags and needsCheck as single-item tagging)', () => {
    const raw = garment([100, 100, 600, 600], { subcategory: 'tee', colours: ['Gray'], fit: 'boxy' }, {
      confidence: { ...sure, colours: 0.5 },
    });
    const g = ok({ garments: [raw] }).garments[0]!;
    const shared = parseGarmentTags(raw);
    expect(g.tags).toEqual(shared.tags);
    expect(g.needsCheck).toEqual(shared.needsCheck);
    expect(g.tags).toMatchObject({ subcategory: 't_shirt', colours: ['grey'], fit: null });
    expect(g.needsCheck).toContain('colours');
  });

  it('rejects junk without throwing', () => {
    for (const raw of ['{not json', null, 42, [menswear], {}, { garments: 'shirt' }, { garments: [1, 'x', null] }]) {
      const r = parseDetectionResponse(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_response');
    }
  });

  it('an empty list means no clothing in the photo', () => {
    const r = parseDetectionResponse({ garments: [] });
    expect(r).toMatchObject({ ok: false, reason: 'not_garment' });
  });

  it('clamps out-of-range boxes to the photo and fixes reversed corners', () => {
    const r = ok({ garments: [garment([-50, 900, 400, 1200], { subcategory: 'coat' }), garment([800, 600, 500, 100], { subcategory: 'jeans' })] });
    expect(r.garments[0]?.box).toEqual({ x: 0.9, y: 0, w: 0.1, h: 0.4 });
    expect(r.garments[1]?.box).toEqual({ x: 0.1, y: 0.5, w: 0.5, h: 0.3 });
    for (const g of r.garments) expect(isValidSourceBox(g.box)).toBe(true);
  });

  it('drops missing, malformed and degenerate boxes and says so', () => {
    const r = ok({
      garments: [
        garment([100, 100, 500, 500], { subcategory: 'hoodie' }),
        garment([100, 100, 105, 500], { subcategory: 'belt' }), // 0.5 % tall
        garment([100, 100, 500], { subcategory: 'cap' }),
        garment(['a', 1, 2, 3], { subcategory: 'scarf' }),
        { ...garment([0, 0, 0, 0], {}), box_2d: undefined },
      ],
    });
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['hoodie']);
    expect(r.warnings).toEqual(['dropped_boxes']);
  });

  it('drops a duplicate box of the same garment but keeps layered garments that overlap', () => {
    const r = ok({
      garments: [
        garment([100, 200, 700, 800], { subcategory: 'coat' }),
        garment([110, 210, 700, 790], { subcategory: 'parka' }), // same outerwear piece again
        garment([105, 205, 695, 795], { subcategory: 'dress' }), // dress under the coat: different category
      ],
    });
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['coat', 'dress']);
    expect(r.warnings).toEqual(['dropped_boxes']);
  });

  it('keeps a shirt under a knit (menswear) as two garments', () => {
    const r = ok({
      garments: [
        garment([200, 250, 600, 750], { subcategory: 'knit', colours: ['navy'] }),
        garment([190, 260, 610, 740], { subcategory: 'shirt', colours: ['light_blue'] }), // collar + cuffs peek out
      ],
    });
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['knit', 'shirt']);
    expect(r.warnings).toEqual([]);
  });

  it('keeps a t-shirt under an open jacket (womenswear) as two garments', () => {
    const r = ok({
      garments: [
        garment([180, 200, 620, 800], { subcategory: 'jacket', colours: ['black'], materials: ['leather'] }),
        garment([200, 230, 600, 770], { subcategory: 't_shirt', colours: ['white'] }),
      ],
    });
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['jacket', 't_shirt']);
  });

  it('still drops the same top reported twice', () => {
    const r = ok({
      garments: [
        garment([200, 250, 600, 750], { subcategory: 'knit' }),
        garment([205, 255, 600, 745], { subcategory: 'hoodie' }), // same mid layer
      ],
    });
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['knit']);
    expect(r.warnings).toEqual(['dropped_boxes']);
  });

  it('merges the two shoes of a pair into one garment with the union box', () => {
    const r = ok({
      garments: [
        garment([100, 100, 800, 900], { subcategory: 'dress' }),
        garment([880, 300, 980, 450], { subcategory: 'sneakers', colours: ['white'] }),
        garment([870, 520, 990, 680], { subcategory: 'sneakers', colours: ['white'] }),
        garment([880, 700, 960, 800], { subcategory: 'boots' }),
      ],
    });
    expect(r.garments.map((g) => g.tags.subcategory)).toEqual(['dress', 'sneakers', 'boots']);
    expect(r.garments[1]?.box).toEqual({ x: 0.3, y: 0.87, w: 0.38, h: 0.12 });
    expect(isValidSourceBox(r.garments[1]?.box)).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('keeps at most 8 garments, most prominent first', () => {
    const many = Array.from({ length: 12 }, (_, i) => garment([i * 80, 0, i * 80 + 70, 300], { subcategory: 'scarf' }));
    const r = ok({ garments: many });
    expect(r.garments).toHaveLength(MAX_GARMENTS);
    expect(r.garments[0]?.box.y).toBe(0);
    expect(r.warnings).toEqual(['too_many_garments']);
  });

  it('drops weak detections and marks unsure ones so the UI leaves them unticked', () => {
    const r = ok({
      garments: [
        garment([0, 0, 500, 500], { subcategory: 'jacket' }, { detection_confidence: 0.9 }),
        garment([500, 0, 1000, 500], { subcategory: 'trousers' }, { detection_confidence: 0.45 }),
        garment([500, 500, 1000, 1000], { subcategory: 'sneakers' }, { detection_confidence: 0.1 }),
        garment([0, 500, 500, 1000], { subcategory: 'cap' }, { detection_confidence: 'n/a' }),
      ],
    });
    expect(r.garments.map((g) => [g.tags.subcategory, g.uncertain])).toEqual([
      ['jacket', false], ['trousers', true], ['cap', true],
    ]);
    expect(r.garments[2]?.detectionConfidence).toBeNull();
  });
});

describe('boxes', () => {
  it('normaliseBox rounds to 4 decimals and never lets x + w pass 1', () => {
    const b = normaliseBox([0, 333.33, 1000, 1000])!;
    expect(b).toEqual({ x: 0.3333, y: 0, w: 0.6667, h: 1 });
    expect(b.x + b.w).toBeLessThanOrEqual(1.0001);
  });

  it('isValidSourceBox mirrors the database check', () => {
    expect(isValidSourceBox({ x: 0.12, y: 0.3, w: 0.4, h: 0.55 })).toBe(true);
    expect(isValidSourceBox({ x: 0.7, y: 0, w: 0.4, h: 0.5 })).toBe(false);
    expect(isValidSourceBox({ x: 0, y: 0, w: 0, h: 0.5 })).toBe(false);
    expect(isValidSourceBox({ x: '0', y: 0, w: 1, h: 1 })).toBe(false);
    expect(isValidSourceBox(null)).toBe(false);
  });

  it('unionBox covers both boxes', () => {
    expect(unionBox({ x: 0.1, y: 0.8, w: 0.2, h: 0.1 }, { x: 0.5, y: 0.75, w: 0.2, h: 0.2 })).toEqual({ x: 0.1, y: 0.75, w: 0.6, h: 0.2 });
  });

  it('boxIoU', () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(boxIoU(a, a)).toBe(1);
    expect(boxIoU(a, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 })).toBe(0);
    expect(boxIoU(a, { x: 0.25, y: 0, w: 0.5, h: 0.5 })).toBeCloseTo(1 / 3);
  });

  it('boxToCropRect pads, clamps to the image and returns whole pixels', () => {
    expect(boxToCropRect({ x: 0.25, y: 0.18, w: 0.5, h: 0.4 }, 1000, 1600, 0)).toEqual({ originX: 250, originY: 288, width: 500, height: 640 });
    expect(boxToCropRect({ x: 0.25, y: 0.2, w: 0.5, h: 0.4 }, 1000, 1000)).toEqual({ originX: 225, originY: 180, width: 550, height: 440 });
    // Padding at the edge stays inside the image.
    expect(boxToCropRect({ x: 0, y: 0.9, w: 1, h: 0.1 }, 800, 600)).toEqual({ originX: 0, originY: 537, width: 800, height: 63 });
  });

  it('boxToCropRect rejects bad input and never returns an empty rect', () => {
    expect(boxToCropRect({ x: 0.5, y: 0.5, w: 0.8, h: 0.2 }, 100, 100)).toBeNull();
    expect(boxToCropRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, 0, 100)).toBeNull();
    expect(boxToCropRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, NaN, 100)).toBeNull();
    const tiny = boxToCropRect({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }, 10, 10)!;
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.originX + tiny.width).toBeLessThanOrEqual(10);
  });
});
