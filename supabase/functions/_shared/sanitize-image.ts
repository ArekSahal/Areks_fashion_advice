// Image sanitisers for process-image. Pure TypeScript with no imports and no Deno or Node globals, so
// Vitest can test it from src/lib/sanitizeImage.test.ts. The format is always sniffed from the bytes;
// the file name and content type the client sent are never trusted.
//
// WebP: a WebP file is a RIFF container: "RIFF" <u32 size> "WEBP", then chunks of <fourcc> <u32 size> <payload> [pad].
// We keep only the chunks needed to show a still image (VP8X, ALPH, VP8 / VP8L) and drop everything else
// (EXIF, XMP, ICCP and unknown chunks), clear the matching VP8X flags and rewrite the sizes.
// Spec: https://developers.google.com/speed/webp/docs/riff_container

export class ImageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageFormatError';
  }
}

export type SanitizedImage = { bytes: Uint8Array; width: number; height: number };

const VP8X_ALPHA = 0x10;
const VP8X_ANIMATION = 0x02;

function fourcc(dv: DataView, at: number): string {
  return String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
}

function uint24(dv: DataView, at: number): number {
  return dv.getUint8(at) | (dv.getUint8(at + 1) << 8) | (dv.getUint8(at + 2) << 16);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const dv = view(bytes);
  return fourcc(dv, 0) === 'RIFF' && fourcc(dv, 8) === 'WEBP';
}

type Chunk = { id: string; start: number; size: number };

function frameSize(dv: DataView, chunk: Chunk): { width: number; height: number } {
  if (chunk.id === 'VP8 ') {
    // 3-byte frame tag, start code 9d 01 2a, then 14-bit width and height.
    if (chunk.size < 10) throw new ImageFormatError('VP8 chunk too small');
    const p = chunk.start;
    if ((dv.getUint8(p) & 1) !== 0) throw new ImageFormatError('VP8 frame is not a key frame');
    if (dv.getUint8(p + 3) !== 0x9d || dv.getUint8(p + 4) !== 0x01 || dv.getUint8(p + 5) !== 0x2a) {
      throw new ImageFormatError('VP8 start code missing');
    }
    return { width: dv.getUint16(p + 6, true) & 0x3fff, height: dv.getUint16(p + 8, true) & 0x3fff };
  }
  // VP8L: signature 0x2f, then 14 bits (width - 1) and 14 bits (height - 1).
  if (chunk.size < 5) throw new ImageFormatError('VP8L chunk too small');
  if (dv.getUint8(chunk.start) !== 0x2f) throw new ImageFormatError('VP8L signature missing');
  const bits = dv.getUint32(chunk.start + 1, true);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

/** Validates a still WebP image and returns a copy without metadata. Throws ImageFormatError if it isn't one. */
export function sanitizeWebp(input: Uint8Array): SanitizedImage {
  if (!isWebp(input)) throw new ImageFormatError('Not a WebP file');
  const dv = view(input);
  const riffSize = dv.getUint32(4, true);
  const end = riffSize + 8;
  if (riffSize < 4 || end > input.byteLength) throw new ImageFormatError('Truncated WebP file');

  const chunks: Chunk[] = [];
  for (let p = 12; p < end; ) {
    if (p + 8 > end) throw new ImageFormatError('Truncated chunk header');
    const size = dv.getUint32(p + 4, true);
    const start = p + 8;
    if (start + size > end) throw new ImageFormatError('Chunk overruns file');
    chunks.push({ id: fourcc(dv, p), start, size });
    p = start + size + (size & 1);
  }

  const images = chunks.filter((c) => c.id === 'VP8 ' || c.id === 'VP8L');
  const image = images[0];
  if (!image || images.length !== 1) throw new ImageFormatError('Expected exactly one image frame');
  if (chunks.some((c) => c.id === 'ANIM' || c.id === 'ANMF')) throw new ImageFormatError('Animated WebP is not supported');

  const frame = frameSize(dv, image);
  if (frame.width === 0 || frame.height === 0) throw new ImageFormatError('Empty image');

  const vp8x = chunks.find((c) => c.id === 'VP8X');
  let header: Uint8Array | null = null;
  let alpha: Chunk | undefined;
  if (vp8x) {
    if (chunks[0] !== vp8x || vp8x.size < 10) throw new ImageFormatError('Malformed VP8X chunk');
    const flags = dv.getUint8(vp8x.start);
    if (flags & VP8X_ANIMATION) throw new ImageFormatError('Animated WebP is not supported');
    const canvas = { width: uint24(dv, vp8x.start + 4) + 1, height: uint24(dv, vp8x.start + 7) + 1 };
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      throw new ImageFormatError('Canvas and frame size differ');
    }
    // Only lossy frames carry a separate ALPH chunk; it must come before the frame.
    alpha = image.id === 'VP8 ' ? chunks.find((c) => c.id === 'ALPH' && c.start < image.start) : undefined;
    header = new Uint8Array(10);
    header.set(input.subarray(vp8x.start, vp8x.start + 10));
    // Keep only the alpha flag; ICC, EXIF and XMP flags are cleared with their chunks. Reserved bytes zeroed.
    header[0] = flags & VP8X_ALPHA;
    header[1] = 0;
    header[2] = 0;
    header[3] = 0;
  }

  const parts: { id: string; payload: Uint8Array }[] = [];
  if (header) parts.push({ id: 'VP8X', payload: header });
  if (alpha) parts.push({ id: 'ALPH', payload: input.subarray(alpha.start, alpha.start + alpha.size) });
  parts.push({ id: image.id, payload: input.subarray(image.start, image.start + image.size) });

  const body = parts.reduce((n, c) => n + 8 + c.payload.byteLength + (c.payload.byteLength & 1), 4);
  const out = new Uint8Array(8 + body);
  const ov = view(out);
  const writeFourcc = (at: number, id: string) => {
    for (let i = 0; i < 4; i++) ov.setUint8(at + i, id.charCodeAt(i));
  };
  writeFourcc(0, 'RIFF');
  ov.setUint32(4, body, true);
  writeFourcc(8, 'WEBP');
  let at = 12;
  for (const c of parts) {
    writeFourcc(at, c.id);
    ov.setUint32(at + 4, c.payload.byteLength, true);
    out.set(c.payload, at + 8);
    at += 8 + c.payload.byteLength + (c.payload.byteLength & 1); // pad byte stays 0
  }
  return { bytes: out, width: frame.width, height: frame.height };
}

// JPEG: used for browsers that can't encode WebP in a canvas (Safari), where the app re-encodes to JPEG instead.
// We rebuild the file from an allowlist of markers (frame, tables, scans) and drop everything else:
// APP0–APP15 (JFIF thumbnails, EXIF incl. GPS, XMP, ICC, IPTC…), comments and anything after the end marker.
// The one exception is an Adobe APP14 segment, which tells decoders the colour transform (no personal data).

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isSof(m: number): boolean {
  return m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

function keepSegment(m: number, dv: DataView, start: number, length: number): boolean {
  if (m >= 0xc0 && m <= 0xcf && m !== 0xc8) return true; // SOFn, DHT (C4), DAC (CC)
  if (m === 0xdb || m === 0xdd || m === 0xda) return true; // DQT, DRI, SOS
  if (m === 0xee && length >= 7) return fourcc(dv, start + 2) === 'Adob' && dv.getUint8(start + 6) === 0x65; // "Adobe"
  return false;
}

/** Validates a baseline/progressive JPEG and returns a copy without metadata. Throws ImageFormatError otherwise. */
export function sanitizeJpeg(input: Uint8Array): SanitizedImage {
  if (!isJpeg(input)) throw new ImageFormatError('Not a JPEG file');
  const dv = view(input);
  const len = input.byteLength;
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  let width = 0;
  let height = 0;
  let scans = 0;
  let ended = false;

  let p = 2;
  while (p < len) {
    if (dv.getUint8(p) !== 0xff) throw new ImageFormatError('Expected a marker');
    while (p + 1 < len && dv.getUint8(p + 1) === 0xff) p++; // fill bytes
    if (p + 1 >= len) break;
    const m = dv.getUint8(p + 1);
    const markerAt = p;
    p += 2;
    if (m === 0xd9) {
      parts.push(Uint8Array.of(0xff, 0xd9));
      ended = true;
      break; // anything after EOI is dropped
    }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xd8) continue; // stray standalone markers: drop
    if (p + 2 > len) throw new ImageFormatError('Truncated segment');
    const length = dv.getUint16(p);
    const segEnd = p + length;
    if (length < 2 || segEnd > len) throw new ImageFormatError('Segment overruns file');
    if (isSof(m)) {
      if (length < 8) throw new ImageFormatError('Frame header too small');
      height = dv.getUint16(p + 3);
      width = dv.getUint16(p + 5);
    }
    if (keepSegment(m, dv, p, length)) parts.push(input.subarray(markerAt, segEnd));
    p = segEnd;

    if (m === 0xda) {
      // Entropy-coded data runs until a marker that isn't a stuffed byte (FF 00) or a restart marker (RSTn).
      let q = p;
      while (q + 1 < len) {
        if (dv.getUint8(q) === 0xff) {
          const n = dv.getUint8(q + 1);
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            q += 2;
            continue;
          }
          if (n !== 0xff) break;
        }
        q++;
      }
      if (q + 1 >= len) throw new ImageFormatError('Truncated scan');
      parts.push(input.subarray(p, q));
      p = q;
      scans++;
    }
  }

  if (!ended || scans === 0) throw new ImageFormatError('Incomplete JPEG');
  if (width === 0 || height === 0) throw new ImageFormatError('Missing frame size');

  const out = new Uint8Array(parts.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.byteLength;
  }
  return { bytes: out, width, height };
}

export type ImageFormat = 'webp' | 'jpeg';

/** Sniffs the format from the bytes and sanitises. Throws ImageFormatError for anything else (PNG, HEIC, junk…). */
export function sanitizeImage(input: Uint8Array): SanitizedImage & { format: ImageFormat } {
  if (isWebp(input)) return { ...sanitizeWebp(input), format: 'webp' };
  if (isJpeg(input)) return { ...sanitizeJpeg(input), format: 'jpeg' };
  throw new ImageFormatError('Unsupported image format');
}
