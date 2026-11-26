// #56 slice 3a: wear count and "last worn" on the item screen. Pure helpers (tested in wearStats.test.ts) plus the
// supabase-js read. The numbers come from the view public.item_wear_stats (supabase/migrations/20261117090000_outfit_diary.sql):
// derived from the diary, security_invoker, so RLS only returns the caller's own items.
import { dayLabel } from './diary';
import { supabase } from './supabase';

export type WearStats = {
  /** Distinct days the item was logged in the diary. */
  wear_count: number;
  /** Last day it was logged (`YYYY-MM-DD`), or null if never. */
  last_worn_on: string | null;
};

export const NOT_WORN: WearStats = { wear_count: 0, last_worn_on: null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A row from item_wear_stats as WearStats. A missing or malformed row counts as never worn. */
export function wearStatsFromRow(row: unknown): WearStats {
  if (typeof row !== 'object' || row === null) return { ...NOT_WORN };
  const r = row as { wear_count?: unknown; last_worn_on?: unknown };
  const n = Number(r.wear_count);
  const wear_count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const last_worn_on =
    wear_count > 0 && typeof r.last_worn_on === 'string' && DAY.test(r.last_worn_on) ? r.last_worn_on : null;
  return { wear_count, last_worn_on };
}

/** "Not worn yet", "Worn once" or "Worn 3 times". */
export function wearCountText(count: number): string {
  if (!(count > 0)) return 'Not worn yet';
  if (count === 1) return 'Worn once';
  return `Worn ${count} times`;
}

/** E.g. "Worn 3 times · last worn yesterday" or "Not worn yet". `today` is the local day (`localDateString()`). */
export function wearSummary(stats: WearStats, today: string): string {
  const count = wearCountText(stats.wear_count);
  if (!(stats.wear_count > 0) || !stats.last_worn_on) return count;
  const day = dayLabel(stats.last_worn_on, today);
  // "Today" / "Yesterday" read better in lower case mid-sentence; dates ("Mon 20 Nov") keep their capitals.
  const when = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
  return `${count} · last worn ${when}`;
}

/** Wear stats for one of the user's items. No row (e.g. not your item, RLS) reads as never worn. */
export async function getItemWearStats(itemId: string): Promise<WearStats> {
  const { data, error } = await supabase
    .from('item_wear_stats')
    .select('item_id, wear_count, last_worn_on')
    .eq('item_id', itemId)
    .maybeSingle();
  if (error) throw error;
  return wearStatsFromRow(data);
}
