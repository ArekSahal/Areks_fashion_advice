// Copies the MediaPipe face detector (library, WebAssembly runtime, model) into public/mediapipe/ so the web build
// serves it from the app's own origin (src/lib/webFaceDetector.ts). Runs before every web export (npm run build:web,
// npm run web, and the Pages workflow). public/mediapipe/ is gitignored.
//
// - Library + wasm: copied from node_modules/@mediapipe/tasks-vision (version pinned exactly in package.json).
// - Model: not in the npm package, so it's downloaded from Google's official MediaPipe model bucket and checked
//   against MODEL_SHA256 below. A mismatch fails the build, so a changed or tampered file never ships.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = 'node_modules/@mediapipe/tasks-vision';
const OUT = 'public/mediapipe';
const MODEL_FILE = 'blaze_face_short_range.tflite';
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/${MODEL_FILE}`;
// SHA-256 of MODEL_URL (229,746 bytes), recorded from the first CI run on PR #42 (the agent sandbox can't reach
// storage.googleapis.com). If Google ever changes the file, the build fails until someone checks it and updates this.
const MODEL_SHA256 = 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  console.error(`::error::vendor-mediapipe: ${message}`);
  process.exit(1);
};

const wanted = JSON.parse(readFileSync('package.json', 'utf8')).dependencies?.['@mediapipe/tasks-vision'];
if (!existsSync(`${PKG}/package.json`)) fail(`${PKG} is not installed (run npm ci)`);
const installed = JSON.parse(readFileSync(`${PKG}/package.json`, 'utf8')).version;
if (wanted !== installed) fail(`package.json pins ${wanted}, but ${installed} is installed`);

mkdirSync(`${OUT}/wasm`, { recursive: true });
copyFileSync(`${PKG}/vision_bundle.mjs`, `${OUT}/vision_bundle.mjs`);
const wasmFiles = readdirSync(`${PKG}/wasm`);
for (const file of wasmFiles) copyFileSync(join(PKG, 'wasm', file), join(OUT, 'wasm', file));
if (!wasmFiles.includes('vision_wasm_internal.wasm')) fail('vision_wasm_internal.wasm missing from the package');

const modelPath = join(OUT, MODEL_FILE);
let model = existsSync(modelPath) ? readFileSync(modelPath) : null;
if (!model || sha256(model) !== MODEL_SHA256) {
  const res = await fetch(MODEL_URL);
  if (!res.ok) fail(`model download failed: HTTP ${res.status}`);
  model = Buffer.from(await res.arrayBuffer());
}
const hash = sha256(model);
if (hash !== MODEL_SHA256) {
  fail(`model sha256 ${hash} does not match the pinned ${MODEL_SHA256}`);
}
writeFileSync(modelPath, model);
console.log(`vendor-mediapipe: tasks-vision ${installed}, ${wasmFiles.length} wasm files, model ${model.length} bytes (sha256 ${hash})`);
