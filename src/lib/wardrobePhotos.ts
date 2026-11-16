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
