// detect-garments (#36 slice 2): finds every garment in one wardrobe photo with Gemini on Vertex AI (EU), see
// docs/ai-providers.md. POST { photo_id } with the user's JWT. Sends the cleaned photo only if faces were blurred or
// the user turned on "Let AI see faces" (same rule as tag-item). Returns each garment with a box in the
// clothing_items.source_box format plus suggested tags; it writes no items (the Add flow saves the garments the user
// confirms, slice 3). Every Vertex call is logged in api_usage with feature `detect_garments`.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DETECTION_SCHEMA_VERSION, buildDetectionRequest, parseDetectionResponse } from '../../../src/lib/detection.ts';
import {
  TAGGING_MODEL,
  type Usage,
  bytesToBase64,
  extractResponseText,
  parseUsage,
} from '../../../src/lib/vertex.ts';
import { IMAGE_LIMITS } from '../_shared/sanitize-image.ts';
import { VertexError, callModel, loadVertexConfig, logAiUsage } from '../_shared/vertex.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FEATURE = 'detect_garments';
/** Guard for the $20/month budget: one detection costs a few tagging calls' worth of output tokens. */
const DAILY_LIMIT = 30;
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
  const photoId = body?.photo_id;
  if (typeof photoId !== 'string' || !UUID.test(photoId)) return json({ error: 'invalid_photo_id' }, 400);

  // Read with the user's token: RLS guarantees the photo belongs to the caller.
  const { data: photo, error: photoError } = await userClient
    .from('wardrobe_photos')
    .select('id, owner_id, image_path, faces_blurred_at')
    .eq('id', photoId)
    .maybeSingle();
  if (photoError) {
    console.error('detect-garments: photo read failed', photoError.message);
    return json({ error: 'detection_failed' }, 500);
  }
  if (!photo || photo.owner_id !== userId) return json({ error: 'photo_not_found' }, 404);
  // Server-set path: {owner_id}/photos/{id}/clean.* in item-photos (migration 20261115123000_wardrobe_photos).
  if (!photo.image_path || !photo.image_path.startsWith(`${userId}/photos/${photoId}/`)) {
    return json({ error: 'no_photo' }, 409);
  }

  // Privacy: never send an unblurred photo unless the user allowed it (docs/architecture.md → Faces).
  if (!photo.faces_blurred_at) {
    const { data: profile } = await userClient
      .from('profiles').select('consent_face_analysis').eq('id', userId).maybeSingle();
    if (profile?.consent_face_analysis !== true) {
      return json({
        error: 'needs_face_consent',
        message: 'This photo has not been face-blurred yet. Turn on "Let AI see faces" in Profile or add items yourself.',
      }, 409);
    }
  }

  const admin = createClient(url, serviceKey);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from('api_usage').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('provider', 'vertex').eq('feature', FEATURE).gte('created_at', since);
  // Fail closed: if usage can't be counted, the call can't be capped.
  if (countError) {
    console.error('detect-garments: usage count failed', countError.message);
    return json({ error: 'detection_failed' }, 500);
  }
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily_limit_reached' }, 429);

  let cfg;
  try {
    cfg = loadVertexConfig();
  } catch (e) {
    console.error('detect-garments: Vertex not configured', e instanceof Error ? e.message : e);
    return json({ error: 'ai_not_configured' }, 503);
  }

  const { data: file, error: fileError } = await admin.storage.from('item-photos').download(photo.image_path);
  if (fileError || !file) {
    console.error('detect-garments: photo download failed', fileError?.message);
    return json({ error: 'photo_unavailable' }, 409);
  }
  // Same cap as process-image enforces on upload, re-checked before base64 (which holds ~2.3x the bytes in memory).
  if (file.size > IMAGE_LIMITS.clean.maxBytes) {
    console.error('detect-garments: photo too large', file.size);
    return json({ error: 'photo_too_large' }, 413);
  }
  const image = { mimeType: file.type || 'image/webp', data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };

  let usage: Usage | null = null;
  let response: Record<string, unknown>;
  try {
    response = await callModel(cfg, TAGGING_MODEL, 'generateContent', buildDetectionRequest(image));
    usage = parseUsage(response);
  } catch (e) {
    const err = e instanceof VertexError ? e : new VertexError('request', null, 'unexpected error');
    console.error('detect-garments: Vertex call failed', err.step, err.status, err.message);
    if (err.step === 'request') {
      await logAiUsage(admin, { userId, feature: FEATURE, model: TAGGING_MODEL, location: cfg.location, usage: null, ok: false });
    }
    return json({ error: 'ai_unavailable' }, 502);
  }

  const extracted = extractResponseText(response);
  const result = extracted.ok
    ? parseDetectionResponse(extracted.text)
    : { ok: false as const, reason: 'invalid_response' as const, message: `AI reply ${extracted.reason}` };
  await logAiUsage(admin, {
    userId, feature: FEATURE, model: TAGGING_MODEL, location: cfg.location, usage, ok: result.ok,
  });

  if (!result.ok) {
    console.warn('detect-garments: no garments', result.reason, extracted.ok ? null : extracted.detail);
    return json({ error: result.reason, message: result.message }, 422);
  }

  return json({
    status: 'detected',
    photo_id: photoId,
    schema_version: DETECTION_SCHEMA_VERSION,
    model: TAGGING_MODEL,
    garments: result.garments.map((g) => ({
      box: g.box,
      detection_confidence: g.detectionConfidence,
      uncertain: g.uncertain,
      tags: g.tags,
      confidence: g.confidence,
      needs_check: g.needsCheck,
      warnings: g.warnings,
    })),
    warnings: result.warnings,
  });
});
