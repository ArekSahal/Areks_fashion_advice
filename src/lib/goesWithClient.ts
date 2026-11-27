import { GOES_WITH_COLUMNS, goesWithFor, type GoesWithOptions, type GoesWithResult, type GoesWithRow } from './goesWith';
import { supabase } from './supabase';

/**
 * "What goes with this?" for one of the user's items (#62). One read of the user's tag columns (no photos, no AI, no
 * Channel3), then pure ranking in goesWith.ts. Filtered on owner_id as well as RLS, so a future marketplace read policy
 * can't pull other people's items into your matches. Capped at the newest 500 items, like the Wardrobe grid.
 */
export async function fetchGoesWith(userId: string, itemId: string, opts: GoesWithOptions = {}): Promise<GoesWithResult> {
  const { data, error } = await supabase
    .from('clothing_items')
    .select(GOES_WITH_COLUMNS)
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as GoesWithRow[];
  // The seed may be older than the newest 500; fetch it on its own so the screen doesn't say "not found".
  if (!rows.some((r) => r.id === itemId)) {
    const { data: seed, error: seedError } = await supabase
      .from('clothing_items')
      .select(GOES_WITH_COLUMNS)
      .eq('owner_id', userId)
      .eq('id', itemId)
      .maybeSingle();
    if (seedError) throw seedError;
    if (seed) rows.push(seed as GoesWithRow);
  }
  return goesWithFor(itemId, rows, opts);
}
