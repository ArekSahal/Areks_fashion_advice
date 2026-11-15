/**
 * Pure helpers for the add-item photo flow (no React Native, no DOM), so they can be unit-tested.
 * Platform code lives in preparePhoto.ts (native) and preparePhoto.web.ts (browser canvas).
 */

import type { FaceCheck } from './faceBlur';

/** Longest side of the photo we upload. process-image rejects anything above PHOTO_LIMITS. */
export const CLEAN_MAX_SIDE = 1600;
export const THUMB_MAX_SIDE = 400;
export const CLEAN_QUALITY = 0.85;
export const THUMB_QUALITY = 0.75;

/** Formats process-image accepts. WebP everywhere except browsers that can't encode it (Safari), which send JPEG. */
export type PhotoFormat = 'webp' | 'jpeg';

export const PHOTO_EXTENSION: Record<PhotoFormat, string> = { webp: 'webp', jpeg: 'jpg' };
export const PHOTO_MIME: Record<PhotoFormat, string> = { webp: 'image/webp', jpeg: 'image/jpeg' };

/** A photo ready to upload: re-encoded (no EXIF/GPS), downscaled, plus a thumbnail. */
export type PreparedPhoto = {
  format: PhotoFormat;
  /** Whether faces were blurred on the device before encoding (see faceBlur.ts). */
  faceCheck: FaceCheck;
  clean: Blob | ArrayBuffer;
  thumb: Blob | ArrayBuffer;
};

/** Scales width × height down (never up) so the longest side is at most maxSide. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error('Image has no size');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Map([...B64].map((c, i) => [c, i] as const));

/** Decodes standard base64 (as returned by expo-image-manipulator) into an ArrayBuffer for upload. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/[\s=]/g, '');
  const buffer = new ArrayBuffer(Math.floor((clean.length * 3) / 4));
  const out = new Uint8Array(buffer);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const c of clean) {
    const v = B64_LOOKUP.get(c);
    if (v === undefined) throw new Error('Invalid base64');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return buffer;
}

/** Random v4 UUID for the upload. Not security-relevant: the server builds every path from the caller's id. */
export function newUploadId(random: () => number = Math.random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Where the app uploads in uploads-quarantine. Must match quarantinePaths() in supabase/functions/process-image. */
export function quarantinePaths(userId: string, uploadId: string, format: PhotoFormat): { clean: string; thumb: string } {
  const ext = PHOTO_EXTENSION[format];
  return { clean: `${userId}/${uploadId}.${ext}`, thumb: `${userId}/${uploadId}.thumb.${ext}` };
}

/** Wardrobe grid columns: 2 on phones, more on wider screens (docs/design-system.md → PhotoGrid). */
export function gridColumns(width: number): number {
  if (width >= 1100) return 5;
  if (width >= 840) return 4;
  if (width >= 600) return 3;
  return 2;
}
