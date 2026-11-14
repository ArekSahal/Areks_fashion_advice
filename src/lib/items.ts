import { newUploadId, PHOTO_MIME, quarantinePaths, type PreparedPhoto } from './photo';
import { supabase } from './supabase';

export type WardrobeItem = {
  id: string;
  thumb_path: string | null;
  image_path: string | null;
  category: string | null;
  subcategory: string | null;
  /** Null until the user confirmed the tags; until then category/subcategory are only AI suggestions. */
  tags_confirmed_at: string | null;
  created_at: string;
};

const SIGNED_URL_SECONDS = 60 * 60;

/** The signed-in user's items, newest first (RLS only returns your own rows). */
export async function listMyItems(): Promise<WardrobeItem[]> {
  const { data, error } = await supabase
    .from('clothing_items')
    .select('id, thumb_path, image_path, category, subcategory, tags_confirmed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as WardrobeItem[];
}

/** Short-lived signed links for private item photos, keyed by path. Paths that fail are left out. */
export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from('item-photos').createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) throw error;
  const urls: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}

/**
 * Uploads a prepared photo to uploads-quarantine and asks process-image to turn it into a wardrobe item.
 * Returns the new item's id.
 */
export async function addItemFromPhoto(userId: string, photo: PreparedPhoto): Promise<string> {
  const uploadId = newUploadId();
  const paths = quarantinePaths(userId, uploadId, photo.format);
  const contentType = PHOTO_MIME[photo.format];
  const bucket = supabase.storage.from('uploads-quarantine');
  for (const [path, body] of [
    [paths.clean, photo.clean],
    [paths.thumb, photo.thumb],
  ] as const) {
    // upsert: false, because the bucket policy only allows inserts (clients can't read or overwrite).
    const { error } = await bucket.upload(path, body, { contentType, upsert: false });
    if (error) throw error;
  }

  const { data, error } = await supabase.functions.invoke<{ item_id: string }>('process-image', {
    body: { upload_id: uploadId, format: photo.format, face_check: photo.faceCheck },
  });
  if (error) throw error;
  if (!data?.item_id) throw new Error('Empty response');
  return data.item_id;
}
