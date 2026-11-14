import type { ImagePickerAsset } from 'expo-image-picker';
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

function draw(source: CanvasImageSource, width: number, height: number, maxSide: number): HTMLCanvasElement {
  const size = fitWithin(width, height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/** Shrinks the region to a few pixels and stretches it back: a strong blur that works in every browser. */
function blurRegion(canvas: HTMLCanvasElement, region: Box) {
  const cells = blurCells(region);
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
    boxes = detectFaces(await loadFaceDetector(), canvas);
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
      blurRegion(canvas, region);
      blurred += 1;
    }
  } catch (e) {
    console.warn('Face blur failed', e);
    return 'skipped';
  }
  return faceCheckResult({ detectorRan: true, found, blurred });
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
  let format: PhotoFormat = 'webp';
  let clean = await toBlob(cleanCanvas, PHOTO_MIME.webp, CLEAN_QUALITY);
  if (clean.type !== PHOTO_MIME.webp) {
    format = 'jpeg';
    clean = await toBlob(cleanCanvas, PHOTO_MIME.jpeg, CLEAN_QUALITY);
  }
  const thumbCanvas = draw(cleanCanvas, cleanCanvas.width, cleanCanvas.height, THUMB_MAX_SIDE);
  const thumb = await toBlob(thumbCanvas, PHOTO_MIME[format], THUMB_QUALITY);
  return { format, faceCheck, clean, thumb };
}
