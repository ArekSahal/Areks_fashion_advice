// Tests for the process-image Edge Function's metadata stripping (supabase/functions/_shared/sanitize-image.ts).
// Fixtures are real 16×20 files made with Pillow that carry EXIF (Make "Canon", Model "GPSSECRET") and, for the
// lossy WebP, an XMP packet ("XMPSECRET").
import { describe, expect, it } from 'vitest';
import {
  ImageFormatError,
  sanitizeImage,
  sanitizeJpeg,
  sanitizeWebp,
} from '../../supabase/functions/_shared/sanitize-image';
import { base64ToArrayBuffer } from './photo';

const WEBP_LOSSY =
  'UklGRtQAAABXRUJQVlA4WAoAAAAMAAAADwAAEwAAVlA4IDYAAADQAgCdASoQABQAPtFUo0uoJKMhsAgBABoJQBOgBaSAAP7p7PwaBQAD/8bx/ku/t321/UnAAABFWElGNgAAAE1NACoAAAAIAAIBDwACAAAABgAAACYBEAACAAAACgAAACwAAAAAQ2Fub24AR1BTU0VDUkVUAFhNUCA5AAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyI+WE1QU0VDUkVUPC94OnhtcG1ldGE+AA==';
const WEBP_LOSSLESS =
  'UklGRm4AAABXRUJQVlA4WAoAAAAIAAAADwAAEwAAVlA4TBEAAAAvD8AEAAdQjyIXpf+BiOh/AABFWElGNgAAAE1NACoAAAAIAAIBDwACAAAABgAAACYBEAACAAAACgAAACwAAAAAQ2Fub24AR1BTU0VDUkVUAA==';
const JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QA+RXhpZgAATU0AKgAAAAgAAgEPAAIAAAAGAAAAJgEQAAIAAAAKAAAALAAAAABDYW5vbgBHUFNTRUNSRVQA/9sAQwAQCwwODAoQDg0OEhEQExgoGhgWFhgxIyUdKDozPTw5Mzg3QEhcTkBEV0U3OFBtUVdfYmdoZz5NcXlwZHhcZWdj/9sAQwEREhIYFRgvGhovY0I4QmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj/8AAEQgAFAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8AyKKKK5D6gKKKKAP/2Q==';
const JPEG_PROGRESSIVE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QA+RXhpZgAATU0AKgAAAAgAAgEPAAIAAAAGAAAAJgEQAAIAAAAKAAAALAAAAABDYW5vbgBHUFNTRUNSRVQA/9sAQwAQCwwODAoQDg0OEhEQExgoGhgWFhgxIyUdKDozPTw5Mzg3QEhcTkBEV0U3OFBtUVdfYmdoZz5NcXlwZHhcZWdj/9sAQwEREhIYFRgvGhovY0I4QmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj/8IAEQgAFAAQAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAE/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAMF/9oADAMBAAIQAxAAAAGMR1AP/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABBQJf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwE//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwE//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQAGPwJf/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPyFf/9oADAMBAAIAAwAAABD77//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QP//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QP//EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEAAT8QX//Z';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAUCAIAAAALACogAAAAIElEQVR4XmM8IafBQApgIkUxCIxqIAaMhhIxYDSUiAEAWLwBNuc5YYwAAAAASUVORK5CYII=';

const bytes = (b64: string) => new Uint8Array(base64ToArrayBuffer(b64));
const ascii = (b: Uint8Array) => String.fromCharCode(...b);
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);

/** Lists the RIFF chunk ids of a WebP file. */
function chunkIds(b: Uint8Array): string[] {
  const ids: string[] = [];
  for (let p = 12; p < b.length; ) {
    const size = u32(b, p + 4);
    ids.push(ascii(b.subarray(p, p + 4)));
    p += 8 + size + (size & 1);
  }
  return ids;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('sanitizeWebp', () => {
  it('drops EXIF and XMP chunks, clears their flags and fixes the RIFF size', () => {
    const input = bytes(WEBP_LOSSY);
    expect(chunkIds(input)).toEqual(['VP8X', 'VP8 ', 'EXIF', 'XMP ']);

    const out = sanitizeWebp(input);
    expect(out.width).toBe(16);
    expect(out.height).toBe(20);
    expect(chunkIds(out.bytes)).toEqual(['VP8X', 'VP8 ']);
    expect(out.bytes[20]).toBe(0); // VP8X flags: EXIF (0x08) and XMP (0x04) cleared
    expect(u32(out.bytes, 4)).toBe(out.bytes.length - 8);
    expect(ascii(out.bytes)).not.toMatch(/GPSSECRET|XMPSECRET|Canon/);
  });

  it('keeps the image data byte for byte', () => {
    const input = bytes(WEBP_LOSSY);
    const out = sanitizeWebp(input).bytes;
    const frameIn = input.subarray(30, 30 + 8 + u32(input, 34));
    expect(out.subarray(30, 30 + frameIn.length)).toEqual(frameIn);
  });

  it('handles lossless frames', () => {
    const out = sanitizeWebp(bytes(WEBP_LOSSLESS));
    expect(out).toMatchObject({ width: 16, height: 20 });
    expect(chunkIds(out.bytes)).toEqual(['VP8X', 'VP8L']);
    expect(ascii(out.bytes)).not.toMatch(/GPSSECRET/);
  });

  it('is idempotent', () => {
    const once = sanitizeWebp(bytes(WEBP_LOSSY)).bytes;
    expect(sanitizeWebp(once).bytes).toEqual(once);
  });

  it('rejects truncated files', () => {
    const input = bytes(WEBP_LOSSY);
    expect(() => sanitizeWebp(input.subarray(0, 60))).toThrow(ImageFormatError);
  });

  it('rejects animated WebP', () => {
    const input = bytes(WEBP_LOSSLESS).slice();
    input[20] = (input[20] ?? 0) | 0x02; // VP8X animation flag
    expect(() => sanitizeWebp(input)).toThrow(/Animated/);
  });

  it('rejects a canvas size that does not match the frame', () => {
    const input = bytes(WEBP_LOSSLESS).slice();
    input[24] = 99; // canvas width - 1
    expect(() => sanitizeWebp(input)).toThrow(ImageFormatError);
  });
});

describe('sanitizeJpeg', () => {
  it('drops APP segments (JFIF, EXIF) and keeps the frame size', () => {
    const out = sanitizeJpeg(bytes(JPEG));
    expect(out).toMatchObject({ width: 16, height: 20 });
    expect(ascii(out.bytes)).not.toMatch(/Exif|JFIF|GPSSECRET|Canon/);
    expect([out.bytes[0], out.bytes[1], out.bytes[2], out.bytes[3]]).toEqual([0xff, 0xd8, 0xff, 0xdb]); // SOI then DQT
    expect([out.bytes.at(-2), out.bytes.at(-1)]).toEqual([0xff, 0xd9]);
  });

  it('handles progressive JPEGs with several scans', () => {
    const out = sanitizeJpeg(bytes(JPEG_PROGRESSIVE));
    expect(out).toMatchObject({ width: 16, height: 20 });
    expect(ascii(out.bytes)).not.toMatch(/GPSSECRET/);
  });

  it('drops comments, metadata hidden between scans and data after the end marker', () => {
    const input = bytes(JPEG);
    const eoi = input.length - 2;
    const comment = concat(Uint8Array.of(0xff, 0xfe, 0x00, 0x0b), new TextEncoder().encode('LATLONG00'));
    const tampered = concat(input.subarray(0, eoi), comment, input.subarray(eoi), new TextEncoder().encode('TRAILER'));
    const out = sanitizeJpeg(tampered);
    expect(ascii(out.bytes)).not.toMatch(/LATLONG|TRAILER/);
    expect(out.bytes).toEqual(sanitizeJpeg(input).bytes);
  });

  it('rejects truncated files', () => {
    const input = bytes(JPEG);
    expect(() => sanitizeJpeg(input.subarray(0, input.length - 10))).toThrow(ImageFormatError);
  });
});

describe('sanitizeImage', () => {
  it('sniffs the format from the bytes', () => {
    expect(sanitizeImage(bytes(WEBP_LOSSY)).format).toBe('webp');
    expect(sanitizeImage(bytes(JPEG)).format).toBe('jpeg');
  });

  it('rejects other formats', () => {
    expect(() => sanitizeImage(bytes(PNG))).toThrow(ImageFormatError);
    expect(() => sanitizeImage(new TextEncoder().encode('RIFF....WAVEfmt '))).toThrow(ImageFormatError);
    expect(() => sanitizeImage(new Uint8Array(0))).toThrow(ImageFormatError);
  });
});
