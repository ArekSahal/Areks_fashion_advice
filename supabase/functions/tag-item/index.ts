// tag-item: suggests tags for one wardrobe item with Gemini on Vertex AI (EU), see docs/ai-providers.md.
// POST { item_id, force? } with the user's JWT. Sends the cleaned photo only if faces were blurred or the user
// turned on "Let AI see faces". Stores the suggestion (tag columns + tag_confidence); tags_confirmed_at stays null
// until the user confirms. Every Vertex call is logged in ai_usage.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseTaggingResponse, toItemColumns } from '../../../src/lib/tagging.ts';
import {
  TAGGING_MODEL,
  type Usage,
  buildTaggingRequest,
  bytesToBase64,
  extractResponseText,
  parseUsage,
} from '../../../src/lib/vertex.ts';
import { VertexError, callModel, loadVertexConfig, logAiUsage } from '../_shared/vertex.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Guard for the $20/month budget: one user can't tag more than this many photos per day. */
const DAILY_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);
  const userId = auth.user.id;

  const body = await req.json().catch(() => null);
  const itemId = body?.item_id;
  const force = body?.force === true;
  if (typeof itemId !== 'string' || !UUID.test(itemId)) return json({ error: 'invalid_item_id' }, 400);

  // Read with the user's token: RLS guarantees the item belongs to the caller.
  const { data: item, error: itemError } = await userClient
    .from('clothing_items')
    .select('id, owner_id, image_path, tag_confidence, tags_confirmed_at, faces_blurred_at')
    .eq('id', itemId)
    .maybeSingle();
  if (itemError) {
    console.error('tag-item: item read failed', itemError.message);
    return json({ error: 'tagging_failed' }, 500);
  }
  if (!item || item.owner_id !== userId) return json({ error: 'item_not_found' }, 404);
  if (!item.image_path || !item.image_path.startsWith(`${userId}/`)) return json({ error: 'no_photo' }, 409);

  // The user's confirmed tags are final; re-tagging would only confuse the correction metrics.
  if (item.tags_confirmed_at) return json({ error: 'already_confirmed' }, 409);
  if (item.tag_confidence && !force) {
    return json({ status: 'already_tagged', tag_confidence: item.tag_confidence });
  }

  // Privacy: never send an unblurred photo unless the user allowed it (docs/architecture.md → Faces).
  if (!item.faces_blurred_at) {
    const { data: profile } = await userClient
      .from('profiles').select('consent_face_analysis').eq('id', userId).maybeSingle();
    if (profile?.consent_face_analysis !== true) {
      return json({
        error: 'needs_face_consent',
        message: 'This photo has not been face-blurred yet. Turn on "Let AI see faces" in Profile or add tags yourself.',
      }, 409);
    }
  }

  const admin = createClient(url, serviceKey);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from('ai_usage').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('feature', 'tag_item').gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily_limit_reached' }, 429);

  let cfg;
  try {
    cfg = loadVertexConfig();
  } catch (e) {
    console.error('tag-item: Vertex not configured', e instanceof Error ? e.message : e);
    return json({ error: 'ai_not_configured' }, 503);
  }

  const { data: file, error: fileError } = await admin.storage.from('item-photos').download(item.image_path);
  if (fileError || !file) {
    console.error('tag-item: photo download failed', fileError?.message);
    return json({ error: 'photo_unavailable' }, 409);
  }
  const image = { mimeType: file.type || 'image/webp', data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };

  let usage: Usage | null = null;
  let response: Record<string, unknown>;
  try {
    response = await callModel(cfg, TAGGING_MODEL, 'generateContent', buildTaggingRequest(image));
    usage = parseUsage(response);
  } catch (e) {
    const err = e instanceof VertexError ? e : new VertexError('request', null, 'unexpected error');
    console.error('tag-item: Vertex call failed', err.step, err.status, err.message);
    if (err.step === 'request') {
      await logAiUsage(admin, { userId, feature: 'tag_item', model: TAGGING_MODEL, location: cfg.location, usage: null, ok: false });
    }
    return json({ error: 'ai_unavailable' }, 502);
  }

  const extracted = extractResponseText(response);
  const result = extracted.ok
    ? parseTaggingResponse(extracted.text)
    : { ok: false as const, reason: 'invalid_response' as const, message: `AI reply ${extracted.reason}` };
  await logAiUsage(admin, {
    userId, feature: 'tag_item', model: TAGGING_MODEL, location: cfg.location, usage, ok: result.ok,
  });

  if (!result.ok) {
    console.warn('tag-item: no tags', result.reason, extracted.ok ? null : extracted.detail);
    return json({ error: result.reason, message: result.message }, 422);
  }

  // A forced re-tag keeps the earlier suggestion in tag_confidence.history. The update only matches while the
  // item is still unconfirmed, so a user confirming during the AI call is never overwritten.
  const columns = toItemColumns(result, TAGGING_MODEL, item.tag_confidence);
  const { data: updated, error: updateError } = await admin
    .from('clothing_items').update(columns)
    .eq('id', itemId).eq('owner_id', userId).is('tags_confirmed_at', null)
    .select('id');
  if (updateError) {
    console.error('tag-item: update failed', updateError.message);
    return json({ error: 'tagging_failed' }, 500);
  }
  if (!updated?.length) return json({ error: 'already_confirmed' }, 409);

  return json({
    status: 'tagged',
    tags: result.tags,
    confidence: result.confidence,
    needs_check: result.needsCheck,
    warnings: result.warnings,
  });
});
