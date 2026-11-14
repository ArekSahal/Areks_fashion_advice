/**
 * Browser face detection with MediaPipe Tasks (BlazeFace short-range), used only by preparePhoto.web.ts.
 * The library, its WebAssembly runtime and the model are loaded lazily (prefetched when the Add tab opens).
 * Detection runs fully in the browser and every file is self-hosted on the app's own origin: the build copies
 * them into public/mediapipe/ (scripts/vendor-mediapipe.mjs). The photo never leaves the device for detection.
 *
 * Why the module is imported by URL: Metro can't bundle @mediapipe/tasks-vision (its bundle contains a non-literal
 * `import()`), so the copied vision_bundle.mjs is loaded with the browser's native import(). The npm package is
 * kept for the TypeScript types, the files to copy, and the version pin.
 */
import type { FaceDetector } from '@mediapipe/tasks-vision';
import Constants from 'expo-constants';
import {
  DETECTOR_INPUT_MAX,
  MIN_FACE_SCORE,
  detectionTiles,
  fromTile,
  isSameOriginPath,
  mediapipeUrls,
  type Box,
} from './faceBlur';
import { fitWithin } from './photo';

const LOAD_TIMEOUT_MS = 20_000;

type Vision = typeof import('@mediapipe/tasks-vision');

/** The browser's native import() for a same-origin path. Metro only bundles literal module names, so it's hidden. */
function importSameOrigin(path: string): Promise<unknown> {
  if (!isSameOriginPath(path)) return Promise.reject(new Error('Refusing to import a cross-origin module'));
  // eslint-disable-next-line no-new-func
  return (new Function('path', 'return import(path)') as (p: string) => Promise<unknown>)(path);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Face detector load timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let loading: Promise<FaceDetector> | null = null;

/** Loads the detector once per page. A failed load is not cached, so the next photo tries again. */
export function loadFaceDetector(): Promise<FaceDetector> {
  if (!loading) {
    const urls = mediapipeUrls(Constants.expoConfig?.experiments?.baseUrl);
    loading = withTimeout(
      (async () => {
        const { FaceDetector, FilesetResolver } = (await importSameOrigin(urls.module)) as Vision;
        const fileset = await FilesetResolver.forVisionTasks(urls.wasm);
        return FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: urls.model, delegate: 'CPU' },
          runningMode: 'IMAGE',
          minDetectionConfidence: MIN_FACE_SCORE,
        });
      })(),
      LOAD_TIMEOUT_MS,
    );
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/**
 * Lets the browser paint between tiles so the "preparing" screen stays responsive. Falls back to a timer because
 * requestAnimationFrame doesn't fire in a hidden tab (e.g. the user switched apps), which would stall the upload.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 50);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Face boxes in `canvas` pixel coordinates. Scans the whole image plus overlapping tiles so small faces
 * (full-body mirror selfies) are found too. Throws if detection fails; the caller then fails closed.
 */
export async function detectFaces(detector: FaceDetector, canvas: HTMLCanvasElement): Promise<Box[]> {
  const input = document.createElement('canvas');
  const ctx = input.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  const boxes: Box[] = [];
  for (const tile of detectionTiles(canvas.width, canvas.height)) {
    await nextFrame();
    const size = fitWithin(tile.width, tile.height, DETECTOR_INPUT_MAX);
    input.width = size.width;
    input.height = size.height;
    ctx.drawImage(canvas, tile.x, tile.y, tile.width, tile.height, 0, 0, size.width, size.height);
    const scale = tile.width / size.width;
    for (const detection of detector.detect(input).detections) {
      const box = detection.boundingBox;
      const score = detection.categories[0]?.score ?? 1;
      if (!box || score < MIN_FACE_SCORE) continue;
      boxes.push(fromTile({ x: box.originX, y: box.originY, width: box.width, height: box.height }, tile, scale));
    }
  }
  return boxes;
}
