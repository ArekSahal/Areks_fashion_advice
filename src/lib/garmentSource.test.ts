import { describe, expect, it } from 'vitest';
import type { DetectedGarment } from './detection';
import { garmentsForResponse, itemColumnsFromDetection, parseGarmentSource, storedGarments, toStoredDetections } from './garmentSource';

const PHOTO = '0b8f6c2e-4d7a-4b8e-9c1d-2f3a4b5c6d7e';

const garment = (over: Partial<DetectedGarment> = {}): DetectedGarment => ({
  box: { x: 0.1, y: 0.2, w: 0.4, h: 0.5 },
  tags: {
    category: 'top', subcategory: 'shirt', colours: ['white'], pattern: 'solid', materials: ['cotton'],
    fit: 'regular', formality: 3, seasons: ['spring'], occasions: ['work'],
  },
  confidence: { category: 0.95, colours: 0.8 },
  needsCheck: [],
  warnings: [],
  detectionConfidence: 0.9,
  uncertain: false,
  ...over,
});

describe('toStoredDetections', () => {
  it('keeps every garment in order', () => {
    const stored = toStoredDetections([garment(), garment({ box: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 } })], 'm');
    expect(stored.model).toBe('m');
    expect(stored.garments).toHaveLength(2);
    expect(stored.garments[1]?.box).toEqual({ x: 0.5, y: 0.5, w: 0.3, h: 0.3 });
  });

  it('round-trips: a repeat call answers with exactly what the first call returned', () => {
    const fresh = [garment(), garment({ uncertain: true, detectionConfidence: 0.4 })];
    const stored = storedGarments(JSON.parse(JSON.stringify(toStoredDetections(fresh, 'm'))));
    expect(stored).not.toBeNull();
    expect(garmentsForResponse(stored ?? [])).toEqual(garmentsForResponse(fresh));
  });
});

describe('storedGarments', () => {
  it('ignores missing, empty, other-version or malformed results', () => {
    expect(storedGarments(null)).toBeNull();
    expect(storedGarments({ schema_version: 1, garments: [] })).toBeNull();
    expect(storedGarments({ schema_version: 999, garments: [garment()] })).toBeNull();
    expect(storedGarments({ schema_version: 1, garments: [{ box: { x: 2, y: 0, w: 1, h: 1 }, tags: {} }] })).toBeNull();
  });
});

describe('parseGarmentSource', () => {
  it('accepts a photo id and an index in range', () => {
    expect(parseGarmentSource({ photo_id: PHOTO, garment_index: 0 })).toEqual({ photoId: PHOTO, garmentIndex: 0 });
  });
  it.each([
    null, 'x', {}, { photo_id: 'nope', garment_index: 0 }, { photo_id: PHOTO, garment_index: -1 },
    { photo_id: PHOTO, garment_index: 1.5 }, { photo_id: PHOTO, garment_index: 99 }, { photo_id: PHOTO, garment_index: '0' },
  ])('rejects %j', (raw) => {
    expect(parseGarmentSource(raw)).toBeNull();
  });
});

describe('itemColumnsFromDetection', () => {
  const stored = toStoredDetections([garment()], 'gemini-x');

  it('builds the item from the stored garment: link, box, tags and a reusable suggestion', () => {
    const cols = itemColumnsFromDetection(stored, 0, PHOTO);
    expect(cols?.source_photo_id).toBe(PHOTO);
    expect(cols?.source_box).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.5 });
    expect(cols?.category).toBe('top');
    expect(cols?.tag_confidence.suggested.subcategory).toBe('shirt');
    expect(cols?.tag_confidence.source).toBe('detect_garments');
    expect(cols).not.toHaveProperty('tags_confirmed_at');
  });

  it('returns null for a missing garment or a stored box that is out of bounds', () => {
    expect(itemColumnsFromDetection(stored, 1, PHOTO)).toBeNull();
    expect(itemColumnsFromDetection(null, 0, PHOTO)).toBeNull();
    const bad = { ...stored, garments: [{ ...stored.garments[0], box: { x: 0.9, y: 0, w: 0.5, h: 0.5 } }] };
    expect(itemColumnsFromDetection(bad, 0, PHOTO)).toBeNull();
  });

  it('copies only known tag columns', () => {
    const sneaky = { ...stored, garments: [{ ...stored.garments[0], tags: { category: 'top', owner_id: 'x', tags_confirmed_at: 'now' } }] };
    const cols = itemColumnsFromDetection(sneaky, 0, PHOTO) as Record<string, unknown>;
    expect(cols.category).toBe('top');
    expect(cols).not.toHaveProperty('owner_id');
    expect(cols).not.toHaveProperty('tags_confirmed_at');
  });
});
