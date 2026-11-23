/**
 * #36 slice 3b: pure logic for the "Outfit photo" Add flow (no React Native, no network), so it can be unit-tested.
 *
 * Flow: the app uploads the outfit photo (process-image, target 'wardrobe_photo') → detect-garments → the user ticks
 * the garments to keep → for each ticked garment the app crops it from the face-blurred photo and uploads it with
 * `source: { photo_id, garment_index }`. The server builds each item from its own stored detection (garmentSource.ts),
 * so the app only ever sends the garment's index; the boxes and tags here are for display.
 */
import { isValidSourceBox, MAX_GARMENTS, type SourceBox } from './detection.ts';
import { tagLabel } from './confirmTags.ts';
import { CATEGORIES, COLOURS } from './taxonomy.ts';

const SUBCATEGORY_IDS: readonly string[] = Object.values(CATEGORIES).flat();
const isCategory = (v: string) => Object.prototype.hasOwnProperty.call(CATEGORIES, v);
const isSubcategory = (v: string) => SUBCATEGORY_IDS.includes(v);
const isColour = (v: string) => Object.prototype.hasOwnProperty.call(COLOURS, v);

/** One garment as the picker shows it. `index` is its position in the server's stored detection. */
export type PickerGarment = {
  index: number;
  box: SourceBox;
  /** Short display name from the suggested tags, e.g. "Navy shirt". */
  label: string;
  /** The model wasn't sure this is a separate garment: starts unticked and says "Not sure". */
  uncertain: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "Navy shirt", "Shirt", "Clothing item": the main colour plus the subcategory (or category), from suggested tags. */
export function garmentLabel(tags: unknown): string {
  const r = isRecord(tags) ? tags : {};
  const kind =
    typeof r.subcategory === 'string' && isSubcategory(r.subcategory)
      ? r.subcategory
      : typeof r.category === 'string' && isCategory(r.category)
        ? r.category
        : null;
  const firstColour = Array.isArray(r.colours) ? r.colours[0] : undefined;
  const colour = typeof firstColour === 'string' && isColour(firstColour) ? firstColour : null;
  if (!kind) return colour ? `${tagLabel(colour)} item` : 'Clothing item';
  const noun = tagLabel(kind).toLowerCase().replace(/^t-shirt$/, 'T-shirt');
  return colour ? `${tagLabel(colour)} ${noun}` : tagLabel(kind);
}

/**
 * The garments from a detect-garments reply (`{ status: 'detected' | 'already_detected', photo_id, garments }`).
 * Keeps each garment's original index (the server saves by index) and skips entries without a valid box. Null if
 * the reply isn't a usable detection.
 */
export function garmentsFromDetectResponse(body: unknown, photoId: string): PickerGarment[] | null {
  if (!isRecord(body)) return null;
  if (body.status !== 'detected' && body.status !== 'already_detected') return null;
  if (typeof body.photo_id === 'string' && body.photo_id !== photoId) return null;
  if (!Array.isArray(body.garments)) return null;
  const out: PickerGarment[] = [];
  body.garments.slice(0, MAX_GARMENTS).forEach((g, index) => {
    if (!isRecord(g) || !isValidSourceBox(g.box)) return;
    out.push({ index, box: g.box, label: garmentLabel(g.tags), uncertain: g.uncertain === true });
  });
  return out.length > 0 ? out : null;
}

/** Garments ticked when the picker opens: everything the model was sure about. */
export function initialSelection(garments: readonly PickerGarment[]): number[] {
  return garments.filter((g) => !g.uncertain).map((g) => g.index);
}

/** Ticks or unticks one garment. The result stays in index order. */
export function toggleSelection(selected: readonly number[], index: number): number[] {
  const next = selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index];
  return next.sort((a, b) => a - b);
}

/** Label of the save button: "Save 3 items", "Save 1 item", "Pick at least one item". */
export function saveLabel(count: number): string {
  if (count === 0) return 'Pick at least one item';
  return count === 1 ? 'Save 1 item' : `Save ${count} items`;
}

/** Accessibility label of one garment tile. */
export function garmentA11yLabel(g: PickerGarment): string {
  return g.uncertain ? `${g.label}, not sure this is a separate piece` : g.label;
}

// ---------- Errors ----------

export type DetectErrorKind = 'needs_face_consent' | 'daily_limit' | 'no_garments' | 'not_available' | 'unavailable';

/** Maps a detect-garments error body (`{ error: '...' }`, or nothing on a network error) to what the screen shows. */
export function detectErrorKind(body: unknown): DetectErrorKind {
  const code = isRecord(body) ? body.error : undefined;
  switch (code) {
    case 'needs_face_consent':
      return 'needs_face_consent';
    case 'daily_limit_reached':
      return 'daily_limit';
    case 'not_garment':
      return 'no_garments';
    // Setup or photo problems a retry won't fix.
    case 'ai_not_configured':
    case 'no_photo':
    case 'photo_unavailable':
    case 'photo_too_large':
    case 'photo_not_found':
      return 'not_available';
    default:
      return 'unavailable';
  }
}

/** Plain-words explanation per error, and whether "Try again" can help. Never shows raw codes. */
export const DETECT_ERROR_COPY: Record<DetectErrorKind, { message: string; canRetry: boolean }> = {
  needs_face_consent: {
    message:
      'To keep faces private, we only send photos to the AI after faces are blurred, and we couldn’t confirm that ' +
      'for this photo. You can add the pieces one at a time instead, or let the AI see faces in your photos ' +
      '(turn it off any time in Profile).',
    canRetry: false,
  },
  daily_limit: {
    message: 'You’ve used today’s outfit photo scans. Add pieces one at a time, or come back tomorrow.',
    canRetry: false,
  },
  no_garments: {
    message: 'We couldn’t find any clothes in this photo. Try one where the outfit is clearly visible.',
    canRetry: false,
  },
  not_available: {
    message: 'We can’t look for clothes in this photo right now. Try adding the pieces one at a time.',
    canRetry: false,
  },
  unavailable: {
    message: 'We couldn’t look for clothes right now. Check your connection and try again.',
    canRetry: true,
  },
};

/** Outcome of saving one ticked garment. `already_saved` (a retry after a lost reply) counts as done. */
export type SaveOutcome = 'saved' | 'already_saved' | 'failed';

/** Maps a process-image error body for a garment upload to an outcome. */
export function saveOutcomeFromError(body: unknown): SaveOutcome {
  return isRecord(body) && body.error === 'garment_already_saved' ? 'already_saved' : 'failed';
}

/**
 * Saves the given garments one after another (uploads are a few hundred KB each; one at a time keeps mobile
 * connections and the server's duplicate check simple). `saveOne` resolves to an outcome or throws; a throw counts
 * as `failed`, so one bad garment never stops the rest. `onProgress` gets the outcomes so far after each garment.
 */
export async function saveGarmentsInOrder(
  indexes: readonly number[],
  saveOne: (index: number) => Promise<SaveOutcome>,
  previous: Readonly<Record<number, SaveOutcome>> = {},
  onProgress?: (outcomes: Record<number, SaveOutcome>) => void,
): Promise<Record<number, SaveOutcome>> {
  const outcomes: Record<number, SaveOutcome> = { ...previous };
  for (const index of indexes) {
    try {
      outcomes[index] = await saveOne(index);
    } catch {
      outcomes[index] = 'failed';
    }
    onProgress?.({ ...outcomes });
  }
  return outcomes;
}

/** Indexes that still need saving: ticked and not yet saved. */
export function pendingIndexes(selected: readonly number[], outcomes: Readonly<Record<number, SaveOutcome>>): number[] {
  return selected.filter((i) => outcomes[i] !== 'saved' && outcomes[i] !== 'already_saved');
}

/** Message after a save run, or null when everything was saved. */
export function saveSummary(selected: readonly number[], outcomes: Readonly<Record<number, SaveOutcome>>): string | null {
  const failed = pendingIndexes(selected, outcomes).length;
  if (failed === 0) return null;
  const done = selected.length - failed;
  if (done === 0) return 'We couldn’t save these items. Check your connection and try again.';
  return `Saved ${done} of ${selected.length}. Try again to save the rest.`;
}

// ---------- Crop preview ----------

/**
 * Where to draw the whole photo inside a tile so that only the garment's box shows, fitted ("contain") and centred.
 * The tile clips (overflow hidden); `width`/`height` are the photo's drawn size and `left`/`top` its offset, in the
 * tile's units. Needs the photo's pixel size for the box's aspect ratio. Null for unusable input.
 */
export function cropPreviewLayout(
  box: SourceBox,
  photoWidth: number,
  photoHeight: number,
  tileWidth: number,
  tileHeight: number,
): { width: number; height: number; left: number; top: number } | null {
  if (!isValidSourceBox(box)) return null;
  if (![photoWidth, photoHeight, tileWidth, tileHeight].every((n) => Number.isFinite(n) && n > 0)) return null;
  const boxW = box.w * photoWidth;
  const boxH = box.h * photoHeight;
  const scale = Math.min(tileWidth / boxW, tileHeight / boxH);
  const width = photoWidth * scale;
  const height = photoHeight * scale;
  const left = (tileWidth - boxW * scale) / 2 - box.x * width;
  const top = (tileHeight - boxH * scale) / 2 - box.y * height;
  return { width, height, left, top };
}
