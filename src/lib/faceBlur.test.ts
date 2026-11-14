import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blurCells, detectionTiles, faceCheckResult, fromTile, padBox } from './faceBlur';
import { MEDIAPIPE_VERSION, MEDIAPIPE_WASM_URL } from './webFaceDetector';

describe('padBox', () => {
  it('pads every side, with extra room above for hair', () => {
    expect(padBox({ x: 100, y: 100, width: 100, height: 100 }, 1000, 1000, 0.2)).toEqual({
      x: 80,
      y: 70,
      width: 140,
      height: 150,
    });
  });

  it('clamps to the image', () => {
    expect(padBox({ x: -20, y: 5, width: 60, height: 60 }, 50, 50)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  it('rounds outwards to whole pixels', () => {
    const r = padBox({ x: 10.4, y: 10.4, width: 10.2, height: 10.2 }, 100, 100, 0)!;
    expect(r).toEqual({ x: 10, y: 10, width: 11, height: 11 });
  });

  it('returns null for empty or fully outside boxes', () => {
    expect(padBox({ x: 0, y: 0, width: 0, height: 10 }, 100, 100)).toBeNull();
    expect(padBox({ x: 200, y: 200, width: 10, height: 10 }, 100, 100)).toBeNull();
    expect(padBox({ x: 0, y: 0, width: NaN, height: 10 }, 100, 100)).toBeNull();
  });
});

describe('detectionTiles', () => {
  it('always scans the whole image first', () => {
    expect(detectionTiles(1200, 1600)[0]).toEqual({ x: 0, y: 0, width: 1200, height: 1600 });
  });

  it('covers the whole image with half-size overlapping squares', () => {
    const [, ...tiles] = detectionTiles(1200, 1600);
    for (const t of tiles) {
      expect(t.width).toBe(600);
      expect(t.height).toBe(600);
      expect(t.x + t.width).toBeLessThanOrEqual(1200);
      expect(t.y + t.height).toBeLessThanOrEqual(1600);
    }
    // Every pixel is inside some tile: check a grid of points.
    for (let y = 0; y < 1600; y += 50) {
      for (let x = 0; x < 1200; x += 50) {
        expect(tiles.some((t) => x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height)).toBe(true);
      }
    }
    expect(tiles.length).toBeLessThanOrEqual(20);
  });

  it('skips tiles on tiny images', () => {
    expect(detectionTiles(100, 80)).toHaveLength(1);
  });
});

describe('fromTile', () => {
  it('scales and offsets a box back into image coordinates', () => {
    expect(fromTile({ x: 10, y: 20, width: 30, height: 40 }, { x: 300, y: 600, width: 600, height: 600 }, 2)).toEqual({
      x: 320,
      y: 640,
      width: 60,
      height: 80,
    });
  });
});

describe('blurCells', () => {
  it('keeps about six cells across the face', () => {
    expect(blurCells({ x: 0, y: 0, width: 120, height: 150 })).toEqual({ width: 6, height: 8 });
  });
  it('never goes below one pixel', () => {
    expect(blurCells({ x: 0, y: 0, width: 2, height: 1 })).toEqual({ width: 2, height: 1 });
  });
});

describe('faceCheckResult (fails closed)', () => {
  it('skipped when the detector did not run', () => {
    expect(faceCheckResult({ detectorRan: false, found: 0, blurred: 0 })).toBe('skipped');
  });
  it('none when the detector found no face', () => {
    expect(faceCheckResult({ detectorRan: true, found: 0, blurred: 0 })).toBe('none');
  });
  it('blurred only when every face was blurred', () => {
    expect(faceCheckResult({ detectorRan: true, found: 2, blurred: 2 })).toBe('blurred');
    expect(faceCheckResult({ detectorRan: true, found: 2, blurred: 1 })).toBe('skipped');
  });
});

describe('MediaPipe runtime download', () => {
  it('pins the WebAssembly URL to the installed package version', () => {
    const file = join(process.cwd(), 'node_modules/@mediapipe/tasks-vision/package.json');
    const installed: string = JSON.parse(readFileSync(file, 'utf8')).version;
    expect(installed, 'update MEDIAPIPE_VERSION in webFaceDetector.ts').toBe(MEDIAPIPE_VERSION);
    expect(MEDIAPIPE_WASM_URL).toContain(`@${MEDIAPIPE_VERSION}/`);
  });

  it('the package ships the WebAssembly runtime the browser loads from that URL', () => {
    const wasmDir = join(process.cwd(), 'node_modules/@mediapipe/tasks-vision/wasm');
    expect(existsSync(wasmDir), 'node_modules/@mediapipe/tasks-vision/wasm missing').toBe(true);
    expect(readdirSync(wasmDir)).toContain('vision_wasm_internal.wasm');
  });
});
