import type { ImagePickerAsset } from 'expo-image-picker';
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

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed'))), type, quality),
  );
}

function draw(source: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const size = fitWithin(source.width, source.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/**
 * Web: decode the picked file, downscale on a canvas and re-encode. A canvas export never carries EXIF/GPS.
 * Safari can't encode WebP (it silently returns PNG), so there we fall back to JPEG; process-image accepts both.
 */
export async function preparePhoto(asset: ImagePickerAsset): Promise<PreparedPhoto> {
  const source: Blob = asset.file ?? (await (await fetch(asset.uri)).blob());
  const bitmap = await createImageBitmap(source); // applies the EXIF orientation in current browsers
  try {
    const cleanCanvas = draw(bitmap, CLEAN_MAX_SIDE);
    let format: PhotoFormat = 'webp';
    let clean = await toBlob(cleanCanvas, PHOTO_MIME.webp, CLEAN_QUALITY);
    if (clean.type !== PHOTO_MIME.webp) {
      format = 'jpeg';
      clean = await toBlob(cleanCanvas, PHOTO_MIME.jpeg, CLEAN_QUALITY);
    }
    const thumb = await toBlob(draw(bitmap, THUMB_MAX_SIDE), PHOTO_MIME[format], THUMB_QUALITY);
    return { format, clean, thumb };
  } finally {
    bitmap.close();
  }
}
