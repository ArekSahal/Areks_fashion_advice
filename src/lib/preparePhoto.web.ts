import type { ImagePickerAsset } from 'expo-image-picker';
import type { CropRect } from './detection';
import { blurCells, faceCheckResult, padBox, type Box, type FaceCheck } from './faceBlur';
import {
  CLEAN_MAX_SIDE,
  CLEAN_QUALITY,
  THUMB_MAX_SIDE,
  THUMB_QUALITY,
  PHOTO_MIME,
  fitWithin,
  type PhotoFormat,
  type PreparedPhoto,
} from './photo';
import { detectFaces, loadFaceDetector } from './webFaceDetector';

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed'))), type, quality),
  );
}

function draw(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide: number,
  crop?: CropRect,
): HTMLCanvasElement {
  const size = fitWithin(width, height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingQuality = 'high';
  if (crop) ctx.drawImage(source, crop.originX, crop.originY, crop.width, crop.height, 0, 0, size.width, size.height);
  else ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/** Encodes in the photo's format (WebP, or JPEG where the browser can't encode WebP), plus a thumbnail. */
async function encodeCanvas(canvas: HTMLCanvasElement, preferred: PhotoFormat) {
  let format = preferred;
  let clean = await toBlob(canvas, PHOTO_MIME[format], CLEAN_QUALITY);
  if (clean.type !== PHOTO_MIME[format]) {
    format = 'jpeg';
    clean = await toBlob(canvas, PHOTO_MIME.jpeg, CLEAN_QUALITY);
  }
  const thumbCanvas = draw(canvas, canvas.width, canvas.height, THUMB_MAX_SIDE);
  const thumb = await toBlob(thumbCanvas, PHOTO_MIME[format], THUMB_QUALITY);
  return { format, clean, thumb };
}

/** Shrinks the region to a few pixels and stretches it back: a strong blur that works in every browser. */
function blurRegion(canvas: HTMLCanvasElement, region: Box, faceWidth: number) {
  const cells = blurCells(region, faceWidth);
  const tiny = document.createElement('canvas');
  tiny.width = cells.width;
  tiny.height = cells.height;
  const tinyCtx = tiny.getContext('2d');
  const ctx = canvas.getContext('2d');
  if (!tinyCtx || !ctx) throw new Error('Canvas not available');
  tinyCtx.imageSmoothingQuality = 'high';
  tinyCtx.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, cells.width, cells.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tiny, 0, 0, cells.width, cells.height, region.x, region.y, region.width, region.height);
}

/**
 * Finds faces on the canvas and blurs them in place. Fails closed: if the detector can't load or throws,
 * the result is `skipped` and process-image won't mark the item as face-free.
 */
async function blurFaces(canvas: HTMLCanvasElement): Promise<FaceCheck> {
  let boxes: Box[];
  try {
    boxes = await detectFaces(await loadFaceDetector(), canvas);
  } catch (e) {
    console.warn('Face detection unavailable; uploading without the face-blurred mark', e);
    return 'skipped';
  }
  let found = 0;
  let blurred = 0;
  try {
    for (const box of boxes) {
      const region = padBox(box, canvas.width, canvas.height);
      if (!region) continue;
      found += 1;
      blurRegion(canvas, region, box.width);
      blurred += 1;
    }
  } catch (e) {
    console.warn('Face blur failed', e);
    return 'skipped';
  }
  return faceCheckResult({ detectorRan: true, found, blurred });
}

/** Starts loading the face detector in the background (called when the Add tab opens). Errors surface later. */
export function prefetchFaceDetector(): void {
  loadFaceDetector().catch(() => undefined);
}

/**
 * Web: decode the picked file, downscale on a canvas, blur faces, and re-encode. A canvas export never carries
 * EXIF/GPS. The thumbnail is made from the blurred photo. Safari can't encode WebP (it silently returns PNG),
 * so there we fall back to JPEG; process-image accepts both.
 */
export async function preparePhoto(asset: ImagePickerAsset): Promise<PreparedPhoto> {
  const source: Blob = asset.file ?? (await (await fetch(asset.uri)).blob());
  const bitmap = await createImageBitmap(source); // applies the EXIF orientation in current browsers
  let cleanCanvas: HTMLCanvasElement;
  try {
    cleanCanvas = draw(bitmap, bitmap.width, bitmap.height, CLEAN_MAX_SIDE);
  } finally {
    bitmap.close();
  }
  const faceCheck = await blurFaces(cleanCanvas);
  const { format, clean, thumb } = await encodeCanvas(cleanCanvas, 'webp');
  return { format, faceCheck, clean, thumb, width: cleanCanvas.width, height: cleanCanvas.height };
}

/**
 * Web: one garment cut from an already prepared photo (#36), as a new photo plus thumbnail. It is decoded from the
 * prepared (face-blurred, EXIF-free) copy, so it inherits that photo's face check and never sees the original pixels.
 */
export async function cropPhoto(photo: PreparedPhoto, rect: CropRect): Promise<PreparedPhoto> {
  const source = photo.clean instanceof Blob ? photo.clean : new Blob([photo.clean], { type: PHOTO_MIME[photo.format] });
  const bitmap = await createImageBitmap(source);
  let canvas: HTMLCanvasElement;
  try {
    canvas = draw(bitmap, rect.width, rect.height, CLEAN_MAX_SIDE, rect);
  } finally {
    bitmap.close();
  }
  const { format, clean, thumb } = await encodeCanvas(canvas, photo.format);
  return { format, faceCheck: photo.faceCheck, clean, thumb, width: canvas.width, height: canvas.height };
}
