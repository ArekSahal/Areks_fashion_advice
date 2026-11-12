// Health check for the Vertex AI secret: OAuth token + a free countTokens call for the tagging model.
// Spends no money, sends no user data, and returns only { ok, step, status, error, ... } (never the key or token).
// Public (verify_jwt off) so it can be run from SQL via pg_net:
//   select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/vertex-check', body := '{}'::jsonb);
import { createClient } from 'npm:@supabase/supabase-js@2';
import { TAGGING_MODEL, buildCountTokensRequest } from '../../../src/lib/vertex.ts';
import { VertexError, callModel, loadVertexConfig, logAiUsage } from '../_shared/vertex.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  let location: string | null = null;
  try {
    const cfg = loadVertexConfig();
    location = cfg.location;
    const data = await callModel(cfg, TAGGING_MODEL, 'countTokens', buildCountTokensRequest());
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await logAiUsage(admin, {
      userId: null, feature: 'healthcheck', model: TAGGING_MODEL, location, usage: null, ok: true,
    });
    return json({ ok: true, model: TAGGING_MODEL, location, total_tokens: data.totalTokens ?? null });
  } catch (e) {
    const err = e instanceof VertexError ? e : new VertexError('request', null, 'unexpected error');
    console.error('vertex-check failed', err.step, err.status, err.message);
    return json({ ok: false, model: TAGGING_MODEL, location, step: err.step, status: err.status, error: err.message });
  }
});
