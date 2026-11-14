/**
 * Pure helpers for blurring faces on the device before upload (issue #26, docs/ai-providers.md §4).
 * No DOM or React Native here, so it can be unit-tested. The browser code is in preparePhoto.web.ts.
 */

/**
 * What the device did about faces, sent to process-image as `face_check`:
 * - `blurred`: the detector ran and every face it found was blurred before encoding;
 * - `none`: the detector ran and found no face;
 * - `skipped`: no detector ran (native for now, or the web model failed to load or threw).
 * process-image only marks the item face-free (`faces_blurred_at`) for `blurred` or `none`.
 */
export type FaceCheck = 'blurred' | 'none' | 'skipped';

export type Box = { x: number; y: number; width: number; height: number };

/** Extra margin around a detected face box (fraction of the box size on each side): hair, ears, chin. */
export const FACE_PADDING = 0.35;
/** Faces below this detector score are ignored. Kept low on purpose: blurring a non-face costs little. */
export const MIN_FACE_SCORE = 0.4;

/**
 * Grows a detected box by `padding` on each side (more above the box for the forehead and hair)
 * and clamps it to the image. Returns integer pixel bounds, or null if nothing of the box is inside the image.
 */
export function padBox(box: Box, imageWidth: number, imageHeight: number, padding = FACE_PADDING): Box | null {
  if (!(box.width > 0 && box.height > 0) || imageWidth <= 0 || imageHeight <= 0) return null;
  const padX = box.width * padding;
  const padY = box.height * padding;
  const left = Math.max(0, Math.floor(box.x - padX));
  const top = Math.max(0, Math.floor(box.y - padY * 1.5));
  const right = Math.min(imageWidth, Math.ceil(box.x + box.width + padX));
  const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height + padY));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Square tiles (with 50 % overlap) to run the detector on, in addition to the whole image.
 * The browser detector (BlazeFace short-range) looks at a 128 px input, so in a full-body mirror selfie the face
 * is too small to find when only the whole photo is scanned. Tiles of half the short side make faces ~2× larger.
 */
export function detectionTiles(imageWidth: number, imageHeight: number): Box[] {
  const tiles: Box[] = [{ x: 0, y: 0, width: imageWidth, height: imageHeight }];
  const size = Math.floor(Math.min(imageWidth, imageHeight) / 2);
  if (size < 64) return tiles;
  const stride = Math.floor(size / 2);
  const starts = (length: number) => {
    const out: number[] = [];
    for (let at = 0; at + size < length; at += stride) out.push(at);
    out.push(length - size); // last tile flush with the edge
    return [...new Set(out)];
  };
  for (const y of starts(imageHeight)) {
    for (const x of starts(imageWidth)) tiles.push({ x, y, width: size, height: size });
  }
  return tiles;
}

/**
 * Moves a box found inside a tile back into whole-image coordinates. `scale` is tile size ÷ the size the tile was
 * drawn at for the detector (tiles are shrunk to DETECTOR_INPUT_MAX first; the model only looks at 128 px anyway).
 */
export function fromTile(box: Box, tile: Box, scale = 1): Box {
  return { x: tile.x + box.x * scale, y: tile.y + box.y * scale, width: box.width * scale, height: box.height * scale };
}

/** Longest side a tile is drawn at before detection. */
export const DETECTOR_INPUT_MAX = 384;

/**
 * Size of the tiny copy a face region is shrunk to before it is scaled back up (a strong blur that works in
 * every browser, unlike `ctx.filter`, which Safari ignores). About 6 cells across, so no facial detail survives.
 */
export function blurCells(region: Box, cellsAcross = 6): { width: number; height: number } {
  const cell = Math.max(1, region.width / cellsAcross);
  return { width: Math.max(1, Math.round(region.width / cell)), height: Math.max(1, Math.round(region.height / cell)) };
}

/**
 * The claim the device makes. Fails closed: if the detector didn't run, or any face could not be blurred,
 * the photo is reported as `skipped` and the server keeps `faces_blurred_at` unset.
 */
export function faceCheckResult(outcome: { detectorRan: boolean; found: number; blurred: number }): FaceCheck {
  if (!outcome.detectorRan) return 'skipped';
  if (outcome.found === 0) return 'none';
  return outcome.blurred >= outcome.found ? 'blurred' : 'skipped';
}
