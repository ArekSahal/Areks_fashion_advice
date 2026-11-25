import { describe, expect, it } from 'vitest';
import {
  DETECT_ERROR_COPY,
  cropPreviewLayout,
  detectErrorKind,
  garmentA11yLabel,
  garmentLabel,
  garmentsFromDetectResponse,
  initialSelection,
  pendingIndexes,
  saveGarmentsInOrder,
  saveLabel,
  saveOutcomeFromError,
  saveSummary,
  toggleSelection,
  CROP_PADDING,
  outcomeCaption,
  padBox,
  type PickerGarment,
  type SaveOutcome,
} from './garmentPicker';

const PHOTO = '0b7c7c1e-8a52-4a3e-9d0e-1f2a3b4c5d6e';

/** A detect-garments reply garment, as garmentsForResponse (garmentSource.ts) writes it. */
function replyGarment(tags: Record<string, unknown>, box = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, uncertain = false) {
  return { box, detection_confidence: uncertain ? 0.5 : 0.9, uncertain, tags, confidence: {}, needs_check: [], warnings: [] };
}

describe('garmentLabel', () => {
  it('uses the main colour and the subcategory', () => {
    expect(garmentLabel({ category: 'top', subcategory: 'shirt', colours: ['navy', 'white'] })).toBe('Navy shirt');
    expect(garmentLabel({ category: 'top', subcategory: 't_shirt', colours: ['off_white'] })).toBe('Off-white T-shirt');
    expect(garmentLabel({ category: 'one_piece', subcategory: 'dress', colours: [] })).toBe('Dress');
    expect(garmentLabel({ category: 'footwear', subcategory: 'heels', colours: ['black'] })).toBe('Black heels');
  });

  it('falls back to the category, then a generic name, and ignores unknown values', () => {
    expect(garmentLabel({ category: 'outerwear', subcategory: null, colours: ['camel'] })).toBe('Camel outerwear');
    expect(garmentLabel({ category: null, subcategory: null, colours: ['grey'] })).toBe('Grey item');
    expect(garmentLabel({ subcategory: 'spacesuit', colours: ['ultraviolet'] })).toBe('Clothing item');
    expect(garmentLabel(null)).toBe('Clothing item');
  });

  it('falls back to the category when the subcategory needs checking', () => {
    const tags = { category: 'top', subcategory: 'blouse', colours: ['white'] };
    expect(garmentLabel(tags, ['subcategory'])).toBe('White top');
    expect(garmentLabel({ category: 'footwear', subcategory: 'loafers', colours: [] }, ['subcategory'])).toBe('Footwear');
  });

  it('leaves out colours that need checking', () => {
    expect(garmentLabel({ category: 'bottom', subcategory: 'chinos', colours: ['beige'] }, ['colours'])).toBe('Chinos');
    expect(garmentLabel({ category: 'top', subcategory: 'knit', colours: ['grey'] }, ['colours', 'subcategory'])).toBe('Top');
    // needs_check flows through from the reply.
    const body = {
      status: 'detected',
      garments: [{ ...replyGarment({ category: 'one_piece', subcategory: 'dress', colours: ['red'] }), needs_check: ['colours'] }],
    };
    expect(garmentsFromDetectResponse(body, PHOTO)?.[0]?.label).toBe('Dress');
  });
});

describe('garmentsFromDetectResponse', () => {
  it('reads fresh and stored detections, keeping the server index of each garment', () => {
    const body = {
      status: 'detected',
      photo_id: PHOTO,
      garments: [
        replyGarment({ category: 'outerwear', subcategory: 'overshirt', colours: ['olive'] }),
        replyGarment({ category: 'top', subcategory: 'shirt', colours: ['white'] }, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, true),
        replyGarment({ category: 'bottom', subcategory: 'chinos', colours: ['beige'] }, { x: 0.2, y: 0.5, w: 0.3, h: 0.45 }),
      ],
    };
    const garments = garmentsFromDetectResponse(body, PHOTO);
    expect(garments?.map((g) => [g.index, g.label, g.uncertain])).toEqual([
      [0, 'Olive overshirt', false],
      [1, 'White shirt', true],
      [2, 'Beige chinos', false],
    ]);
    expect(garmentsFromDetectResponse({ ...body, status: 'already_detected' }, PHOTO)).toHaveLength(3);
  });

  it('skips garments without a valid box but keeps the others at their own index', () => {
    const body = {
      status: 'detected',
      photo_id: PHOTO,
      garments: [
        replyGarment({ subcategory: 'coat' }, { x: 0.9, y: 0, w: 0.5, h: 0.5 }),
        replyGarment({ subcategory: 'jeans' }),
      ],
    };
    expect(garmentsFromDetectResponse(body, PHOTO)?.map((g) => g.index)).toEqual([1]);
  });

  it('rejects replies that are not a usable detection for this photo', () => {
    expect(garmentsFromDetectResponse(null, PHOTO)).toBeNull();
    expect(garmentsFromDetectResponse({ error: 'not_garment' }, PHOTO)).toBeNull();
    expect(garmentsFromDetectResponse({ status: 'detected', photo_id: PHOTO, garments: [] }, PHOTO)).toBeNull();
    expect(
      garmentsFromDetectResponse({ status: 'detected', photo_id: 'other', garments: [replyGarment({})] }, PHOTO),
    ).toBeNull();
  });

  it('never reads past the server cap of 8 garments', () => {
    const garments = Array.from({ length: 10 }, () => replyGarment({ subcategory: 'bag' }));
    expect(garmentsFromDetectResponse({ status: 'detected', garments }, PHOTO)).toHaveLength(8);
  });
});

describe('selection', () => {
  const garments: PickerGarment[] = [
    { index: 0, box: { x: 0, y: 0, w: 0.5, h: 0.5 }, label: 'Navy coat', uncertain: false },
    { index: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 }, label: 'White shirt', uncertain: true },
    { index: 3, box: { x: 0, y: 0, w: 0.5, h: 0.5 }, label: 'Black boots', uncertain: false },
  ];

  it('starts with the sure garments ticked and the unsure ones unticked', () => {
    expect(initialSelection(garments)).toEqual([0, 3]);
  });

  it('toggles and keeps index order', () => {
    expect(toggleSelection([0, 3], 1)).toEqual([0, 1, 3]);
    expect(toggleSelection([0, 1, 3], 0)).toEqual([1, 3]);
    expect(toggleSelection([], 3)).toEqual([3]);
  });

  it('labels the save button and the tiles', () => {
    expect(saveLabel(0)).toBe('Pick at least one item');
    expect(saveLabel(1)).toBe('Save 1 item');
    expect(saveLabel(4)).toBe('Save 4 items');
    expect(garmentA11yLabel(garments[0]!)).toBe('Navy coat');
    expect(garmentA11yLabel(garments[1]!)).toBe('White shirt, not sure this is a separate piece');
  });

  it('says how each save went, on screen and to screen readers', () => {
    expect(outcomeCaption(undefined)).toBeNull();
    expect(outcomeCaption('saved')).toEqual({ text: 'Saved', tone: 'success' });
    expect(outcomeCaption('already_saved')).toEqual({ text: 'Saved', tone: 'success' });
    expect(outcomeCaption('failed')).toEqual({ text: 'Couldn’t save', tone: 'danger' });
    expect(garmentA11yLabel(garments[0]!, 'saved')).toBe('Navy coat, saved');
    expect(garmentA11yLabel(garments[1]!, 'failed')).toBe(
      'White shirt, not sure this is a separate piece, couldn’t save',
    );
  });
});

describe('detectErrorKind', () => {
  it('maps server codes to what the screen explains', () => {
    expect(detectErrorKind({ error: 'needs_face_consent' })).toBe('needs_face_consent');
    expect(detectErrorKind({ error: 'daily_limit_reached' })).toBe('daily_limit');
    expect(detectErrorKind({ error: 'not_garment' })).toBe('no_garments');
    expect(detectErrorKind({ error: 'photo_too_large' })).toBe('not_available');
    expect(detectErrorKind({ error: 'ai_unavailable' })).toBe('unavailable');
    expect(detectErrorKind(null)).toBe('unavailable');
  });

  it('only offers a retry where it can help, and never shows raw codes', () => {
    expect(DETECT_ERROR_COPY.unavailable.canRetry).toBe(true);
    expect(DETECT_ERROR_COPY.needs_face_consent.canRetry).toBe(false);
    expect(DETECT_ERROR_COPY.daily_limit.canRetry).toBe(false);
    for (const { message } of Object.values(DETECT_ERROR_COPY)) expect(message).not.toMatch(/_/);
  });
});

describe('saving', () => {
  it('treats an already saved garment as done', () => {
    expect(saveOutcomeFromError({ error: 'garment_already_saved' })).toBe('already_saved');
    expect(saveOutcomeFromError({ error: 'garment_not_found' })).toBe('failed');
    expect(saveOutcomeFromError(null)).toBe('failed');
  });

  it('saves in order, keeps going after a failure and reports progress', async () => {
    const calls: number[] = [];
    const progress: Record<number, SaveOutcome>[] = [];
    const outcomes = await saveGarmentsInOrder(
      [0, 2, 5],
      async (i) => {
        calls.push(i);
        if (i === 2) throw new Error('network');
        return i === 5 ? 'already_saved' : 'saved';
      },
      {},
      (p) => progress.push(p),
    );
    expect(calls).toEqual([0, 2, 5]);
    expect(outcomes).toEqual({ 0: 'saved', 2: 'failed', 5: 'already_saved' });
    expect(progress).toHaveLength(3);
    expect(progress[0]).toEqual({ 0: 'saved' });
  });

  it('retries only what is left and summarises partial saves', async () => {
    const first: Record<number, SaveOutcome> = { 0: 'saved', 2: 'failed', 5: 'already_saved' };
    expect(pendingIndexes([0, 2, 5], first)).toEqual([2]);
    expect(saveSummary([0, 2, 5], first)).toBe('Saved 2 of 3. Try again to save the rest.');
    expect(saveSummary([2], { 2: 'failed' })).toBe('We couldn’t save these items. Check your connection and try again.');

    const calls: number[] = [];
    const second = await saveGarmentsInOrder(
      pendingIndexes([0, 2, 5], first),
      async (i) => {
        calls.push(i);
        return 'saved';
      },
      first,
    );
    expect(calls).toEqual([2]);
    expect(saveSummary([0, 2, 5], second)).toBeNull();
  });
});

describe('padBox', () => {
  it('widens the box like the saved crop and clamps it to the photo', () => {
    const b = padBox({ x: 0.2, y: 0.2, w: 0.4, h: 0.2 }, CROP_PADDING);
    expect(b.x).toBeCloseTo(0.18);
    expect(b.y).toBeCloseTo(0.19);
    expect(b.w).toBeCloseTo(0.44);
    expect(b.h).toBeCloseTo(0.22);
    const edge = padBox({ x: 0, y: 0.5, w: 1, h: 0.5 }, CROP_PADDING);
    expect(edge).toEqual({ x: 0, y: expect.closeTo(0.475), w: 1, h: expect.closeTo(0.525) });
    expect(padBox({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 0)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });

  it('makes the preview show the padded crop', () => {
    const plain = cropPreviewLayout({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 1000, 1000, 100, 100)!;
    const padded = cropPreviewLayout({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 1000, 1000, 100, 100, CROP_PADDING)!;
    // A wider crop is drawn smaller in the same tile.
    expect(padded.width).toBeLessThan(plain.width);
    expect(padded.width).toBeCloseTo(100 / 0.44);
  });
});

describe('cropPreviewLayout', () => {
  it('fits the box inside the tile and centres it', () => {
    // 1000×1000 photo, box 200×400 px at (100, 100); tile 100×100 → scale 0.25 (height bound).
    const l = cropPreviewLayout({ x: 0.1, y: 0.1, w: 0.2, h: 0.4 }, 1000, 1000, 100, 100);
    expect(l).not.toBeNull();
    expect(l!.width).toBeCloseTo(250);
    expect(l!.height).toBeCloseTo(250);
    // Box is 50 px wide on screen, so 25 px margin each side; its left edge (25 px into the photo) sits at x = 25.
    expect(l!.left).toBeCloseTo(25 - 25);
    expect(l!.top).toBeCloseTo(0 - 25);
  });

  it('keeps the box aspect ratio on non-square photos', () => {
    const l = cropPreviewLayout({ x: 0, y: 0.5, w: 1, h: 0.5 }, 1200, 1600, 120, 150)!;
    // Box is 1200×800 px; width-bound scale 0.1 → drawn box 120×80, centred vertically (35 px margin).
    expect(l.width).toBeCloseTo(120);
    expect(l.height).toBeCloseTo(160);
    expect(l.left).toBeCloseTo(0);
    expect(l.top).toBeCloseTo(35 - 80);
  });

  it('returns null for unusable input', () => {
    expect(cropPreviewLayout({ x: 0.9, y: 0, w: 0.5, h: 0.5 }, 100, 100, 10, 10)).toBeNull();
    expect(cropPreviewLayout({ x: 0, y: 0, w: 0.5, h: 0.5 }, 0, 100, 10, 10)).toBeNull();
    expect(cropPreviewLayout({ x: 0, y: 0, w: 0.5, h: 0.5 }, 100, 100, 0, 10)).toBeNull();
  });
});
