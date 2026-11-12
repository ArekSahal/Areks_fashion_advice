import { describe, expect, it } from 'vitest';
import { base64ToArrayBuffer, fitWithin, gridColumns, newUploadId, quarantinePaths } from './photo';

describe('fitWithin', () => {
  it('scales the longest side down to the limit', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never scales up', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('keeps at least one pixel', () => {
    expect(fitWithin(10000, 2, 400)).toEqual({ width: 400, height: 1 });
  });

  it('rejects images without a size', () => {
    expect(() => fitWithin(0, 100, 400)).toThrow();
  });
});

describe('base64ToArrayBuffer', () => {
  it('decodes with and without padding', () => {
    expect([...new Uint8Array(base64ToArrayBuffer('SGVsbG8='))]).toEqual([72, 101, 108, 108, 111]);
    expect([...new Uint8Array(base64ToArrayBuffer('SGk'))]).toEqual([72, 105]);
    expect([...new Uint8Array(base64ToArrayBuffer('/w=='))]).toEqual([255]);
  });

  it('rejects invalid input', () => {
    expect(() => base64ToArrayBuffer('a$b')).toThrow();
  });
});

describe('newUploadId', () => {
  it('returns a v4 UUID', () => {
    for (let i = 0; i < 20; i++) {
      expect(newUploadId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

describe('quarantinePaths', () => {
  it('puts both files in the user folder with the right extension', () => {
    expect(quarantinePaths('u1', 'abc', 'webp')).toEqual({ clean: 'u1/abc.webp', thumb: 'u1/abc.thumb.webp' });
    expect(quarantinePaths('u1', 'abc', 'jpeg')).toEqual({ clean: 'u1/abc.jpg', thumb: 'u1/abc.thumb.jpg' });
  });
});

describe('gridColumns', () => {
  it('uses 2 columns on phones and more on wide screens', () => {
    expect(gridColumns(390)).toBe(2);
    expect(gridColumns(700)).toBe(3);
    expect(gridColumns(1024)).toBe(4);
    expect(gridColumns(1440)).toBe(5);
  });
});
