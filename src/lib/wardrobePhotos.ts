import {
  detectErrorKind,
  garmentsFromDetectResponse,
  saveOutcomeFromError,
  type DetectErrorKind,
  type PickerGarment,
  type SaveOutcome,
} from './garmentPicker';
import { functionErrorBody, uploadToQuarantine } from './items';
import type { PreparedPhoto } from './photo';
import { supabase } from './supabase';

/** An original outfit photo in the wardrobe (#36): the photo garments were cut from. */
export type WardrobePhoto = {
  id: string;
  image_path: string | null;
  thumb_path: string | null;
  created_at: string;
};

/** Items cut from a photo, as shown on the photo screen. */
export type PhotoItem = {
  id: string;
  thumb_path: string | null;
  image_path: string | null;
  category: string | null;
  subcategory: string | null;
  tags_confirmed_at: string | null;
};

/** The signed-in user's wardrobe photos that finished processing, newest first (RLS only returns your own rows). */
export async function listMyPhotos(): Promise<WardrobePhoto[]> {
  const { data, error } = await supabase
    .from('wardrobe_photos')
    .select('id, image_path, thumb_path, created_at')
    .not('image_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as WardrobePhoto[];
}

/** How many items were saved from each photo, keyed by photo id (photos without items are left out). */
export async function itemCountsByPhoto(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('clothing_items')
    .select('source_photo_id')
    .not('source_photo_id', 'is', null)
    .limit(2000);
  if (error) throw error;
  return countByPhoto((data ?? []) as { source_photo_id: string | null }[]);
}

export function countByPhoto(rows: readonly { source_photo_id: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.source_photo_id) counts[r.source_photo_id] = (counts[r.source_photo_id] ?? 0) + 1;
  return counts;
}

/** One photo and the items saved from it, or null if it doesn't exist (or isn't yours: RLS). */
export async function fetchPhotoWithItems(photoId: string): Promise<{ photo: WardrobePhoto; items: PhotoItem[] } | null> {
  const [photoRes, itemsRes] = await Promise.all([
    supabase.from('wardrobe_photos').select('id, image_path, thumb_path, created_at').eq('id', photoId).maybeSingle(),
    supabase
      .from('clothing_items')
      .select('id, thumb_path, image_path, category, subcategory, tags_confirmed_at')
      .eq('source_photo_id', photoId)
      .order('created_at', { ascending: true })
      .limit(100),
  ]);
  if (photoRes.error) throw photoRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (!photoRes.data) return null;
  return { photo: photoRes.data as WardrobePhoto, items: (itemsRes.data ?? []) as PhotoItem[] };
}

/** "1 item" / "3 items" / "No items yet". */
export function itemCountLabel(n: number): string {
  if (n === 0) return 'No items yet';
  return n === 1 ? '1 item' : `${n} items`;
}

// ---------- Add flow: outfit photo → detected garments → items (#36 slice 3b) ----------

/**
 * Uploads a prepared (face-blurred, EXIF-free) outfit photo and stores it as a wardrobe photo through process-image
 * (`target: 'wardrobe_photo'`). Returns the new photo's id.
 */
export async function addOutfitPhoto(userId: string, photo: PreparedPhoto): Promise<string> {
  const uploadId = await uploadToQuarantine(userId, photo);
  const { data, error } = await supabase.functions.invoke<{ photo_id: string }>('process-image', {
    body: { upload_id: uploadId, format: photo.format, face_check: photo.faceCheck, target: 'wardrobe_photo' },
  });
  if (error) throw error;
  if (!data?.photo_id) throw new Error('Empty response');
  return data.photo_id;
}

export type DetectRequest = { ok: true; garments: PickerGarment[] } | { ok: false; kind: DetectErrorKind };

/**
 * Asks detect-garments for the garments in a wardrobe photo. A repeat call gets the stored result (same indexes),
 * so retrying is safe. Never throws: failures come back as an error kind the screen can explain.
 */
export async function detectGarments(photoId: string): Promise<DetectRequest> {
  try {
    const { data, error } = await supabase.functions.invoke<unknown>('detect-garments', { body: { photo_id: photoId } });
    if (error) return { ok: false, kind: detectErrorKind(await functionErrorBody(error)) };
    const garments = garmentsFromDetectResponse(data, photoId);
    // A successful reply always has garments (none found is a 422 `not_garment`), so anything else is malformed.
    return garments ? { ok: true, garments } : { ok: false, kind: 'unavailable' };
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
}

/**
 * Saves one detected garment as a clothing item: uploads its crop and sends only `{ photo_id, garment_index }`.
 * process-image takes the box and suggested tags from its own stored detection and links the item to the photo.
 * A garment that was already saved (a retry after a lost reply) comes back as `already_saved`.
 */
export async function saveGarment(
  userId: string,
  photoId: string,
  garmentIndex: number,
  crop: PreparedPhoto,
): Promise<SaveOutcome> {
  const uploadId = await uploadToQuarantine(userId, crop);
  const { data, error } = await supabase.functions.invoke<{ item_id: string }>('process-image', {
    body: {
      upload_id: uploadId,
      format: crop.format,
      face_check: crop.faceCheck,
      source: { photo_id: photoId, garment_index: garmentIndex },
    },
  });
  if (error) return saveOutcomeFromError(await functionErrorBody(error));
  return data?.item_id ? 'saved' : 'failed';
}

/**
 * Removes a wardrobe photo the user backed out of (Cancel before any item was saved), so no orphan outfit photo is
 * left behind: first its files in item-photos, then the row. Owner-only through RLS and the storage delete policy.
 * Items already cut from it keep existing (their source_photo_id is set to null by the foreign key).
 */
export async function deleteWardrobePhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase
    .from('wardrobe_photos')
    .select('id, image_path, thumb_path')
    .eq('id', photoId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;
  const row = data as { image_path: string | null; thumb_path: string | null };
  const paths = [row.image_path, row.thumb_path].filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from('item-photos').remove(paths);
    if (removeError) throw removeError;
  }
  const { error: deleteError } = await supabase.from('wardrobe_photos').delete().eq('id', photoId);
  if (deleteError) throw deleteError;
}
