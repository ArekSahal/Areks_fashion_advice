import type { ImagePickerAsset } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  CLEAN_MAX_SIDE,
  CLEAN_QUALITY,
  THUMB_MAX_SIDE,
  THUMB_QUALITY,
  base64ToArrayBuffer,
  fitWithin,
  type PreparedPhoto,
} from './photo';

async function encode(uri: string, width: number, height: number, maxSide: number, compress: number) {
  const size = fitWithin(width, height, maxSide);
  const context = ImageManipulator.manipulate(uri);
  if (size.width !== width || size.height !== height) context.resize(size);
  const image = await context.renderAsync();
  // Re-encoding writes a new file with no EXIF/GPS.
  const result = await image.saveAsync({ format: SaveFormat.WEBP, compress, base64: true });
  if (!result.base64) throw new Error('Image encoding failed');
  return { uri: result.uri, width: result.width, height: result.height, data: base64ToArrayBuffer(result.base64) };
}

/**
 * Native: downscale and re-encode to WebP with expo-image-manipulator, plus a small thumbnail.
 *
 * TODO(#26): blur faces on the device with ML Kit face detection (docs/ai-providers.md §4). That needs an
 * Expo development build (native module), so for now native reports `skipped`: process-image leaves
 * faces_blurred_at unset and tag-item asks for "Let AI see faces" consent before sending the photo to the AI.
 */
export async function preparePhoto(asset: ImagePickerAsset): Promise<PreparedPhoto> {
  const clean = await encode(asset.uri, asset.width, asset.height, CLEAN_MAX_SIDE, CLEAN_QUALITY);
  const thumb = await encode(clean.uri, clean.width, clean.height, THUMB_MAX_SIDE, THUMB_QUALITY);
  return { format: 'webp', faceCheck: 'skipped', clean: clean.data, thumb: thumb.data };
}
