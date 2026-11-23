// #56 slice 2: post today's outfit. Pure helpers (tested in diary.test.ts) plus the supabase-js reads and writes.
// Data model: supabase/migrations/20261117090000_outfit_diary.sql. Several entries per day are allowed, so posting
// always inserts a new entry; editing goes through the entry's id (never an upsert of the day).
import { supabase } from './supabase';

/** Most items one entry can hold: a full outfit plus accessories, and a cap on accidental mass selection. */
export const MAX_OUTFIT_ITEMS = 20;

/** How far back the Diary tab lists past entries. */
export const RECENT_DAYS = 14;

/** The device's local calendar day as `YYYY-MM-DD` (not UTC: just after midnight in Sweden, UTC is still yesterday). */
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The local day `days` before `day` (`YYYY-MM-DD`), counted in calendar days so DST changes don't matter. */
export function addDays(day: string, days: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d + days));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** E.g. "Mon 20 Nov" (English UI, fixed format so it reads the same on every device). */
export function shortDate(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** "Today", "Yesterday" or the short date. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return shortDate(day);
}

/**
 * Short name for an item in the picker ("Jeans"). Unconfirmed AI suggestions are never shown as facts, so items
 * without confirmed tags get no label.
 */
export function pieceLabel(item: {
  tags_confirmed_at: string | null;
  category: string | null;
  subcategory: string | null;
}): string | undefined {
  if (!item.tags_confirmed_at) return undefined;
  const raw = item.subcategory ?? item.category;
  if (!raw) return undefined;
  const text = raw.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Tap to add or remove an item. Order is kept (first picked first); adding past the cap does nothing. */
export function toggleItem(selected: readonly string[], itemId: string, max = MAX_OUTFIT_ITEMS): string[] {
  if (selected.includes(itemId)) return selected.filter((id) => id !== itemId);
  if (selected.length >= max) return [...selected];
  return [...selected, itemId];
}

/** An entry needs something in it: at least one item or a photo. */
export function canSaveOutfit(itemIds: readonly string[], photoId: string | null): boolean {
  return itemIds.length > 0 || photoId !== null;
}

/** Label for the save button, e.g. "Save outfit · 3 items". */
export function saveLabel(itemCount: number, editing: boolean): string {
  const verb = editing ? 'Save changes' : 'Save outfit';
  if (itemCount === 0) return verb;
  return `${verb} · ${itemCount === 1 ? '1 item' : `${itemCount} items`}`;
}

/**
 * Row for `outfits`. Only the columns clients may write (worn_on, photo_id, occasion, notes): owner_id comes from
 * auth.uid(), id from the database.
 */
export function outfitInsert(wornOn: string, photoId: string | null): { worn_on: string; photo_id: string | null } {
  return { worn_on: wornOn, photo_id: photoId };
}

/** Rows for `outfit_items`: outfit_id + item_id only (owner_id defaults to auth.uid()). Duplicates are dropped. */
export function outfitItemRows(outfitId: string, itemIds: readonly string[]): { outfit_id: string; item_id: string }[] {
  return [...new Set(itemIds)].map((item_id) => ({ outfit_id: outfitId, item_id }));
}

/** What changes when an entry is edited: links to add and links to remove (outfit_items has no client update). */
export function itemDiff(current: readonly string[], next: readonly string[]): { add: string[]; remove: string[] } {
  const now = new Set(current);
  const wanted = new Set(next);
  return {
    add: [...wanted].filter((id) => !now.has(id)),
    remove: [...now].filter((id) => !wanted.has(id)),
  };
}

export type DiaryErrorKind = 'stale' | 'date' | 'auth' | 'network';

/** Maps a Postgres / PostgREST error to something the screen can explain. */
export function diaryErrorKind(error: unknown): DiaryErrorKind {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === '23503') return 'stale'; // foreign key: the item or photo was deleted (or isn't yours)
  if (code === '23514') return 'date'; // check: worn_on in the future (device clock far ahead)
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') return 'auth'; // RLS / expired session
  return 'network';
}

export const DIARY_ERROR_MESSAGE: Record<DiaryErrorKind, string> = {
  stale: 'One of those pieces or the photo was just removed. We refreshed your wardrobe, try again.',
  date: 'Your phone’s date looks off, so we couldn’t save this as today. Check the date and try again.',
  auth: 'Please sign in again to save your outfit.',
  network: 'We couldn’t save your outfit. Check your connection and try again.',
};

export type DiaryEntry = {
  id: string;
  worn_on: string;
  photo_id: string | null;
  created_at: string;
  item_ids: string[];
};

/** Attaches item ids to their entries, keeping the order the links were read in. */
export function attachItems(
  outfits: readonly Omit<DiaryEntry, 'item_ids'>[],
  links: readonly { outfit_id: string; item_id: string }[],
): DiaryEntry[] {
  const byOutfit = new Map<string, string[]>();
  for (const l of links) byOutfit.set(l.outfit_id, [...(byOutfit.get(l.outfit_id) ?? []), l.item_id]);
  return outfits.map((o) => ({ ...o, item_ids: byOutfit.get(o.id) ?? [] }));
}

/** Entries grouped by day, newest day first; within a day the earliest entry comes first. */
export function groupByDay(entries: readonly DiaryEntry[]): { day: string; entries: DiaryEntry[] }[] {
  const days = new Map<string, DiaryEntry[]>();
  for (const e of entries) days.set(e.worn_on, [...(days.get(e.worn_on) ?? []), e]);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => ({ day, entries: [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
}

/** The user's entries from `sinceDay` on (RLS only returns your own rows), with the items worn. */
export async function listEntriesSince(sinceDay: string): Promise<DiaryEntry[]> {
  const { data, error } = await supabase
    .from('outfits')
    .select('id, worn_on, photo_id, created_at')
    .gte('worn_on', sinceDay)
    .order('worn_on', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  const outfits = (data ?? []) as Omit<DiaryEntry, 'item_ids'>[];
  if (outfits.length === 0) return [];
  const links = await supabase
    .from('outfit_items')
    .select('outfit_id, item_id')
    .in(
      'outfit_id',
      outfits.map((o) => o.id),
    )
    .order('created_at', { ascending: true })
    .limit(2000);
  if (links.error) throw links.error;
  return attachItems(outfits, (links.data ?? []) as { outfit_id: string; item_id: string }[]);
}

/**
 * Posts a new diary entry and links its items. If linking fails the half-made entry is removed again, so a retry
 * doesn't leave an empty entry behind. Returns the new entry's id.
 */
export async function createOutfit(wornOn: string, itemIds: readonly string[], photoId: string | null): Promise<string> {
  const { data, error } = await supabase.from('outfits').insert(outfitInsert(wornOn, photoId)).select('id').single();
  if (error) throw error;
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error('Empty response');
  const rows = outfitItemRows(id, itemIds);
  if (rows.length > 0) {
    const links = await supabase.from('outfit_items').insert(rows);
    if (links.error) {
      await supabase.from('outfits').delete().eq('id', id);
      throw links.error;
    }
  }
  return id;
}

/** Saves an edited entry: the photo, then removed and added item links. */
export async function updateOutfit(
  entry: Pick<DiaryEntry, 'id' | 'photo_id' | 'item_ids'>,
  itemIds: readonly string[],
  photoId: string | null,
): Promise<void> {
  if (photoId !== entry.photo_id) {
    const { data, error } = await supabase.from('outfits').update({ photo_id: photoId }).eq('id', entry.id).select('id');
    if (error) throw error;
    // The entry is gone (deleted on another device): explain it like other stale data.
    if (!data?.length) throw Object.assign(new Error('Entry not found'), { code: '23503' });
  }
  const { add, remove } = itemDiff(entry.item_ids, itemIds);
  if (remove.length > 0) {
    const { error } = await supabase.from('outfit_items').delete().eq('outfit_id', entry.id).in('item_id', remove);
    if (error) throw error;
  }
  if (add.length > 0) {
    const { error } = await supabase.from('outfit_items').insert(outfitItemRows(entry.id, add));
    if (error) throw error;
  }
}
