/**
 * Multi-garment detection contract (#36 slice 2; owners: Fashion + Platform, see docs/ai-providers.md).
 *
 * The `detect-garments` Edge Function sends one (face-blurred) wardrobe photo to the vision model with
 * DETECTION_PROMPT and DETECTION_RESPONSE_SCHEMA, then runs the reply through parseDetectionResponse(). Each garment
 * comes back with a bounding box in the `clothing_items.source_box` format (fractions of the photo's width/height,
 * see migration 20261115123000_wardrobe_photos.sql) plus tags validated by the same per-garment parser as
 * single-item tagging (parseGarmentTags in tagging.ts), so the taxonomy is defined once.
 *
 * Pure TypeScript: runs in Deno (Edge Functions import it with the `.ts` path), in the app and in Vitest.
 */
import {
  CHECK_THRESHOLD,
  DROP_THRESHOLD,
  GARMENT_TAG_PROPERTIES,
  TAG_FIELDS,
  TAG_RULES,
  type GarmentTags,
  parseGarmentTags,
  readReplyObject,
} from './tagging.ts';

/** Bump when the prompt or schema changes. */
export const DETECTION_SCHEMA_VERSION = 1;
/** Most garments we return for one photo (an outfit rarely has more; caps output tokens and the confirm list). */
export const MAX_GARMENTS = 8;
/** The model reports boxes as integers on a 0–1000 grid (Gemini's native box format). */
export const BOX_SCALE = 1000;
/** Boxes narrower or shorter than this fraction of the photo are dropped as noise. */
export const MIN_BOX_SIDE = 0.02;
/** Two boxes overlapping at least this much (intersection over union) with compatible categories are duplicates. */
export const DUPLICATE_IOU = 0.8;
/** Upper bound on raw entries we look at, so a runaway reply can't make the parser do unbounded work. */
const MAX_RAW_ENTRIES = 50;

/** Same shape as `clothing_items.source_box`: fractions of width/height, top-left origin. */
export interface SourceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedGarment extends GarmentTags {
  box: SourceBox;
  /** How sure the model is that this is a real, separate garment (0–1), or null if it didn't say. */
  detectionConfidence: number | null;
  /** True when the confirm screen should leave this garment unticked by default (detectionConfidence < 0.6). */
  uncertain: boolean;
}

export type DetectionWarning = 'too_many_garments' | 'dropped_boxes';

export type DetectionResult =
  | { ok: true; garments: DetectedGarment[]; warnings: DetectionWarning[] }
  | { ok: false; reason: 'not_garment' | 'invalid_response'; message: string };

// ---------- Prompt ----------

export const DETECTION_PROMPT = [
  'You are an experienced personal stylist cataloguing a customer\'s wardrobe from one photo. The photo may show',
  'a single item, a flat lay of several items, or a person wearing an outfit (often a mirror selfie).',
  `List every separate clothing item, pair of shoes and accessory that is clearly visible, most prominent first,`,
  `at most ${MAX_GARMENTS}. Use only the allowed values in the response schema.`,
  '',
  'Detection rules:',
  `- box_2d: the tight box around that item as [ymin, xmin, ymax, xmax], integers from 0 to ${BOX_SCALE}`,
  '  relative to the image height and width.',
  '- A pair of shoes, socks or gloves is one item with one box around both. Each piece of a suit or set is its',
  '  own item (jacket and trousers separately).',
  '- Box only what is worn or laid out: never the face, hair, skin, phone, furniture or background.',
  '- Skip items that are so hidden or cut off that they could not be tagged.',
  '- detection_confidence: how sure you are (0 to 1) that this is a real, separate garment.',
  '',
  'Tag each item:',
  ...TAG_RULES,
  '',
  'If the photo shows no clothing, shoes or accessory at all, return an empty garments list.',
  'Menswear and womenswear are equally likely. Do not guess brand, size or the wearer\'s gender.',
].join('\n');

// ---------- Response schema (JSON Schema, for Gemini `responseJsonSchema`) ----------

const coordinate = { type: 'integer', minimum: 0, maximum: BOX_SCALE };

export const DETECTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    garments: {
      type: 'array',
      maxItems: MAX_GARMENTS,
      items: {
        type: 'object',
        properties: {
          box_2d: { type: 'array', items: coordinate, minItems: 4, maxItems: 4 },
          detection_confidence: { type: 'number', minimum: 0, maximum: 1 },
          ...GARMENT_TAG_PROPERTIES,
        },
        required: ['box_2d', 'detection_confidence', ...TAG_FIELDS, 'confidence'],
      },
    },
  },
  required: ['garments'],
} as const;

// ---------- Boxes ----------

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Gemini's [ymin, xmin, ymax, xmax] on the 0–1000 grid → a SourceBox. Clamps to the photo, swaps reversed corners,
 * and returns null for anything that isn't four numbers or is too small to be a garment. The result always passes
 * the clothing_items.source_box check constraint (see isValidSourceBox).
 */
export function normaliseBox(raw: unknown): SourceBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map(toNumber);
  if (nums.some((n) => n === null)) return null;
  const clamp = (n: number) => Math.min(1, Math.max(0, n / BOX_SCALE));
  const [y1, x1, y2, x2] = (nums as number[]).map(clamp) as [number, number, number, number];
  const x = round4(Math.min(x1, x2));
  const y = round4(Math.min(y1, y2));
  // Width/height from the rounded corners, so x + w never exceeds 1 after rounding.
  const w = round4(round4(Math.max(x1, x2)) - x);
  const h = round4(round4(Math.max(y1, y2)) - y);
  if (w < MIN_BOX_SIDE || h < MIN_BOX_SIDE) return null;
  return { x, y, w, h };
}

/** Mirrors the clothing_items.source_box check constraint, so the server can validate before writing. */
export function isValidSourceBox(box: unknown): box is SourceBox {
  if (typeof box !== 'object' || box === null || Array.isArray(box)) return false;
  const { x, y, w, h } = box as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return false;
  return (
    x >= 0 && x <= 1 && y >= 0 && y <= 1 &&
    w > 0 && w <= 1 && h > 0 && h <= 1 &&
    x + w <= 1.0001 && y + h <= 1.0001
  );
}

/** Intersection over union of two boxes (0 = apart, 1 = identical). */
export function boxIoU(a: SourceBox, b: SourceBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Pixel crop rectangle for a box on an image of the given size (the shape expo-image-manipulator's `crop` takes).
 * `padding` widens the box by that fraction of its own width/height on each side, so the crop doesn't cut the
 * garment's edges; the rect is always clamped inside the image and at least 1×1. Returns null for an invalid box
 * or image size.
 */
export function boxToCropRect(box: SourceBox, imageWidth: number, imageHeight: number, padding = 0.05): CropRect | null {
  if (!isValidSourceBox(box)) return null;
  if (!(imageWidth >= 1) || !(imageHeight >= 1) || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) {
    return null;
  }
  const pad = Number.isFinite(padding) && padding > 0 ? padding : 0;
  const W = Math.floor(imageWidth);
  const H = Math.floor(imageHeight);
  const left = Math.max(0, (box.x - box.w * pad) * W);
  const top = Math.max(0, (box.y - box.h * pad) * H);
  const right = Math.min(W, (box.x + box.w * (1 + pad)) * W);
  const bottom = Math.min(H, (box.y + box.h * (1 + pad)) * H);
  // The epsilon keeps float noise (0.58 * 1600 = 928.0000000000001) from adding a stray pixel row.
  const EPS = 1e-6;
  const originX = Math.min(W - 1, Math.floor(left + EPS));
  const originY = Math.min(H - 1, Math.floor(top + EPS));
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(W - originX, Math.ceil(right - EPS) - originX)),
    height: Math.max(1, Math.min(H - originY, Math.ceil(bottom - EPS) - originY)),
  };
}

// ---------- Validation ----------

function clampUnit(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

/**
 * Turns the model's detection reply (parsed JSON or the raw JSON string) into at most MAX_GARMENTS garments,
 * most prominent first. Never throws. Drops entries without a usable box, weak detections (< 0.3), and duplicates
 * (same or unknown category with heavily overlapping boxes); tags go through parseGarmentTags, so each garment has
 * its own needsCheck list exactly like single-item tagging.
 */
export function parseDetectionResponse(raw: unknown): DetectionResult {
  const reply = readReplyObject(raw);
  if (!reply.ok) return { ok: false, reason: 'invalid_response', message: reply.message };
  const list = reply.data.garments;
  if (!Array.isArray(list)) {
    return { ok: false, reason: 'invalid_response', message: 'The AI reply had no garments list.' };
  }
  if (list.length === 0) {
    return {
      ok: false,
      reason: 'not_garment',
      message: "We couldn't find any clothing in this photo. Try a photo where the clothes are clearly visible.",
    };
  }

  const garments: DetectedGarment[] = [];
  let dropped = false;
  let overflow = false;
  for (const entry of list.slice(0, MAX_RAW_ENTRIES)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      dropped = true;
      continue;
    }
    const r = entry as Record<string, unknown>;
    const box = normaliseBox(r.box_2d);
    const detectionConfidence = clampUnit(r.detection_confidence);
    if (!box || (detectionConfidence !== null && detectionConfidence < DROP_THRESHOLD)) {
      dropped = true;
      continue;
    }
    const tagged = parseGarmentTags(r);
    const duplicate = garments.some(
      (g) =>
        boxIoU(g.box, box) >= DUPLICATE_IOU &&
        (g.tags.category === null || tagged.tags.category === null || g.tags.category === tagged.tags.category),
    );
    if (duplicate) {
      dropped = true;
      continue;
    }
    if (garments.length >= MAX_GARMENTS) {
      overflow = true;
      continue;
    }
    garments.push({
      ...tagged,
      box,
      detectionConfidence,
      uncertain: detectionConfidence === null || detectionConfidence < CHECK_THRESHOLD,
    });
  }
  if (list.length > MAX_RAW_ENTRIES) overflow = true;

  if (garments.length === 0) {
    return { ok: false, reason: 'invalid_response', message: 'The AI reply had no usable garment boxes.' };
  }
  const warnings: DetectionWarning[] = [];
  if (overflow) warnings.push('too_many_garments');
  if (dropped) warnings.push('dropped_boxes');
  return { ok: true, garments, warnings };
}
