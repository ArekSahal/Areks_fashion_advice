/**
 * Browser face detection with MediaPipe Tasks (BlazeFace short-range), used only by preparePhoto.web.ts.
 * The library, its WebAssembly runtime and the model are loaded lazily, the first time someone adds an item.
 * Detection runs fully in the browser: only code and model files are downloaded, the photo never leaves the device.
 *
 * Downloads (pinned):
 * - Library + WebAssembly runtime: jsDelivr mirror of the npm package, same version as the installed package
 *   (checked by a test). The library is imported from the CDN at runtime instead of bundled: Metro can't bundle
 *   it (its bundle contains a non-literal `import()`), and this keeps ~1 MB out of the app bundle. The npm
 *   package is kept for the TypeScript types and to pin the version.
 * - Model: Google's official MediaPipe model bucket.
 */
import type { FaceDetector } from '@mediapipe/tasks-vision';
import { DETECTOR_INPUT_MAX, MIN_FACE_SCORE, detectionTiles, fromTile, type Box } from './faceBlur';
import { fitWithin } from './photo';

/** Must equal the installed @mediapipe/tasks-vision version (faceBlur.test.ts checks this). */
export const MEDIAPIPE_VERSION = '1.2.3';
const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
export const MEDIAPIPE_MODULE_URL = `${MEDIAPIPE_CDN}/vision_bundle.mjs`;
export const MEDIAPIPE_WASM_URL = `${MEDIAPIPE_CDN}/wasm`;
export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

const LOAD_TIMEOUT_MS = 20_000;

type Vision = typeof import('@mediapipe/tasks-vision');

/** A native browser `import()` that Metro leaves alone (it only bundles literal module names). */
function importFromUrl(url: string): Promise<unknown> {
  // eslint-disable-next-line no-new-func
  return (new Function('url', 'return import(url)') as (u: string) => Promise<unknown>)(url);
}

let loading: Promise<FaceDetector> | null = null;

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

/** Loads the detector once per page. A failed load is not cached, so the next photo tries again. */
export function loadFaceDetector(): Promise<FaceDetector> {
  if (!loading) {
    loading = withTimeout(
      (async () => {
        const { FaceDetector, FilesetResolver } = (await importFromUrl(MEDIAPIPE_MODULE_URL)) as Vision;
        const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        return FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'CPU' },
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
 * Face boxes in `canvas` pixel coordinates. Scans the whole image plus overlapping tiles so small faces
 * (full-body mirror selfies) are found too. Throws if detection fails; the caller then fails closed.
 */
export function detectFaces(detector: FaceDetector, canvas: HTMLCanvasElement): Box[] {
  const input = document.createElement('canvas');
  const ctx = input.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  const boxes: Box[] = [];
  for (const tile of detectionTiles(canvas.width, canvas.height)) {
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
