// Shared paid-API usage log (AGENTS.md → Costs). Writes one row per provider call to public.api_usage
// (created by the AI-usage migration in PR #25: user_id, feature, provider, model, units, input_tokens,
// output_tokens, est_cost_usd, created_at). Callers must treat a failed log as "don't call the provider",
// so no paid call ever goes unlogged or uncapped (e.g. before that table exists).
import type { createClient } from 'npm:@supabase/supabase-js@2';

type Admin = ReturnType<typeof createClient>;

export type UsageRow = {
  user_id: string;
  feature: string;
  provider: string;
  model: string;
  units?: number;
  input_tokens?: number;
  output_tokens?: number;
  est_cost_usd?: number;
};

/** Number of calls for this user + feature in the last 24 hours, or null if it can't be counted. */
export async function usageLast24h(admin: Admin, userId: string, feature: string): Promise<number | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from('api_usage')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('feature', feature)
    .gte('created_at', since);
  if (error) {
    console.warn('usage: count failed', feature, error.message);
    return null;
  }
  return count ?? 0;
}

/** Logs one call. Returns false (with a warning) if the row couldn't be written. */
export async function logUsage(admin: Admin, row: UsageRow): Promise<boolean> {
  const { error } = await admin.from('api_usage').insert(row);
  if (error) {
    console.warn('usage: log failed', row.feature, error.message);
    return false;
  }
  return true;
}
