import {
  suggestionFromResponse,
  tagErrorKind,
  type ConfirmedUpdate,
  type Suggestion,
  type TagColumns,
  type TagErrorKind,
} from './confirmTags';
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
    body: { upload_id: uploadId, format: photo.format },
  });
  if (error) throw error;
  if (!data?.item_id) throw new Error('Empty response');
  return data.item_id;
}

/** One item as the confirm-tags screen needs it. */
export type ItemForTagging = TagColumns & {
  id: string;
  image_path: string | null;
  thumb_path: string | null;
  tag_confidence: unknown;
  tags_confirmed_at: string | null;
};

const TAGGING_COLUMNS =
  'id, image_path, thumb_path, category, subcategory, colours, pattern, materials, fit, formality, seasons, occasions, tag_confidence, tags_confirmed_at';

/** The item with its tag columns, or null if it doesn't exist (or isn't yours: RLS). */
export async function fetchItemForTagging(itemId: string): Promise<ItemForTagging | null> {
  const { data, error } = await supabase
    .from('clothing_items')
    .select(TAGGING_COLUMNS)
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  return (data as ItemForTagging | null) ?? null;
}

export type TagRequest = { ok: true; suggestion: Suggestion } | { ok: false; kind: TagErrorKind };

/** Asks tag-item for suggestions. Never throws: failures come back as an error kind the screen can explain. */
export async function requestTagSuggestion(itemId: string): Promise<TagRequest> {
  try {
    const { data, error } = await supabase.functions.invoke<unknown>('tag-item', { body: { item_id: itemId } });
    if (error) {
      // FunctionsHttpError carries the Response; its JSON body has the error code (e.g. needs_face_consent).
      const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const body = typeof context?.json === 'function' ? await context.json().catch(() => null) : null;
      return { ok: false, kind: tagErrorKind(body) };
    }
    const suggestion = suggestionFromResponse(data);
    return suggestion ? { ok: true, suggestion } : { ok: false, kind: 'unavailable' };
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
}

/** Saves the user's tags and marks them confirmed. Throws if nothing was updated. */
export async function saveConfirmedTags(itemId: string, update: ConfirmedUpdate): Promise<void> {
  const { data, error } = await supabase.from('clothing_items').update(update).eq('id', itemId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Item not found');
}
