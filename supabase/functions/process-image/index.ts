// Add-item photo pipeline (docs/architecture.md → Storage, Key flows).
// The app re-encodes the photo on the device (drops EXIF/GPS), uploads it plus a thumbnail to
// uploads-quarantine/{user_id}/{upload_id}[.thumb].{webp|jpg} and calls this function with
// { upload_id, format, face_check }.
// Here we: check the caller → download with the service role → sniff and validate the bytes (never trusting the
// client) → strip any remaining metadata → enforce size limits → optional background removal → write
// item-photos/{user_id}/{item_id}/clean.* and thumb.* → insert the clothing_items row → delete the quarantine copies.
// Faces are blurred on the device before upload (web: MediaPipe; native: not yet). If the app reports that the
// face step ran (face_check 'blurred' or 'none'), the row gets faces_blurred_at = now(), which lets tag-item send
// the photo to the AI without face consent. Clients can't set that column themselves (column grants).
//
// #36 slice 3 adds two optional request fields:
// - target: 'wardrobe_photo' stores the original outfit photo as a wardrobe_photos row under
//   item-photos/{user_id}/photos/{photo_id}/ (no background removal) and returns { photo_id }, for detect-garments.
// - source: { photo_id, garment_index } on an item upload (a crop of one detected garment) links the new item to its
//   photo. The box and suggested tags come from wardrobe_photos.detections, stored by detect-garments, never from the
//   request (src/lib/garmentSource.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { itemColumnsFromDetection, parseGarmentSource } from '../../../src/lib/garmentSource.ts';
import { faceCheckLabel, facesBlurredAt } from '../_shared/face-check.ts';
import { IMAGE_LIMITS, ImageFormatError, sanitizeImage, type ImageFormat } from '../_shared/sanitize-image.ts';
import { logUsage, usageLast24h } from '../_shared/usage.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const QUARANTINE = 'uploads-quarantine';
const PHOTOS = 'item-photos';

const LIMITS = IMAGE_LIMITS;

const EXT: Record<ImageFormat, string> = { webp: 'webp', jpeg: 'jpg' };
const MIME: Record<ImageFormat, string> = { webp: 'image/webp', jpeg: 'image/jpeg' };
const PHOTOROOM_FEATURE = 'background_removal';
const PHOTOROOM_DAILY_LIMIT = 50;
const PHOTOROOM_COST_USD = 0.02;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RequestError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Same layout as quarantinePaths() in src/lib/photo.ts. Built from the verified user id, never from client paths. */
function quarantinePaths(userId: string, uploadId: string, format: ImageFormat) {
  return { clean: `${userId}/${uploadId}.${EXT[format]}`, thumb: `${userId}/${uploadId}.thumb.${EXT[format]}` };
}

type Admin = ReturnType<typeof createClient>;
type Photo = { bytes: Uint8Array; format: ImageFormat };

async function download(admin: Admin, path: string, limit: { maxBytes: number; maxSide: number }): Promise<Photo> {
  const { data, error } = await admin.storage.from(QUARANTINE).download(path);
  if (error || !data) throw new RequestError('upload_not_found', 404);
  if (data.size > limit.maxBytes) throw new RequestError('image_too_large', 413);
  let clean;
  try {
    clean = sanitizeImage(new Uint8Array(await data.arrayBuffer()));
  } catch (e) {
    if (e instanceof ImageFormatError) throw new RequestError('invalid_image', 422);
    throw e;
  }
  if (Math.max(clean.width, clean.height) > limit.maxSide) throw new RequestError('image_too_large', 413);
  return { bytes: clean.bytes, format: clean.format };
}

/**
 * Optional background removal with Photoroom (docs/ai-providers.md). Runs only when all of these hold:
 * - the PHOTOROOM_API_KEY secret exists;
 * - the user turned on "Let AI see faces" (profiles.consent_face_analysis). Photoroom is a third party, and this
 *   step doesn't know whether the device blurred faces (native and older clients don't), so consent is required;
 * - the user is under PHOTOROOM_DAILY_LIMIT calls in the last 24 h, counted in api_usage;
 * - the call could be logged in api_usage first (so nothing paid goes unlogged or uncapped).
 * Otherwise, or on any failure, the photo is kept as taken. Returns a transparent WebP, re-sanitised like any input.
 */
async function removeBackground(admin: Admin, userId: string, photo: Photo): Promise<Photo> {
  const key = Deno.env.get('PHOTOROOM_API_KEY');
  if (!key) return photo;
  try {
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('consent_face_analysis')
      .eq('id', userId)
      .maybeSingle();
    if (profileError || profile?.consent_face_analysis !== true) return photo;

    const used = await usageLast24h(admin, userId, PHOTOROOM_FEATURE);
    if (used === null || used >= PHOTOROOM_DAILY_LIMIT) return photo;
    const logged = await logUsage(admin, {
      user_id: userId,
      feature: PHOTOROOM_FEATURE,
      provider: 'photoroom',
      model: 'segment-v1',
      units: 1,
      unit: 'calls',
      cost_estimate_usd: PHOTOROOM_COST_USD,
    });
    if (!logged) return photo;

    const form = new FormData();
    form.append('image_file', new Blob([photo.bytes], { type: MIME[photo.format] }), `photo.${EXT[photo.format]}`);
    form.append('format', 'webp');
    const res = await fetch('https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: { 'x-api-key': key },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn('process-image: background removal failed', res.status);
      return photo;
    }
    const out = sanitizeImage(new Uint8Array(await res.arrayBuffer()));
    const fits = out.bytes.byteLength <= LIMITS.clean.maxBytes && Math.max(out.width, out.height) <= LIMITS.clean.maxSide;
    return fits ? { bytes: out.bytes, format: out.format } : photo;
  } catch (e) {
    console.warn('process-image: background removal skipped', e);
    return photo;
  }
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

  const body = await req.json().catch(() => ({}));
  const uploadId = typeof body?.upload_id === 'string' ? body.upload_id : '';
  const format: ImageFormat | null = body?.format === 'webp' || body?.format === 'jpeg' ? body.format : null;
  if (!UUID.test(uploadId) || !format) return json({ error: 'bad_request' }, 400);
  const target = body?.target === undefined || body?.target === 'item' ? 'item' : body?.target === 'wardrobe_photo' ? 'wardrobe_photo' : null;
  if (!target) return json({ error: 'bad_request' }, 400);
  const garmentSource = body?.source === undefined ? null : parseGarmentSource(body.source);
  if (body?.source !== undefined && (!garmentSource || target !== 'item')) return json({ error: 'bad_request' }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const source = quarantinePaths(userId, uploadId, format);
  const written: string[] = [];

  try {
    // A garment crop needs the stored detection of the caller's own photo. Checked before any file is written.
    let fromDetection: ReturnType<typeof itemColumnsFromDetection> = null;
    if (garmentSource) {
      const { data: photo, error: photoError } = await admin
        .from('wardrobe_photos')
        .select('id, detections')
        .eq('id', garmentSource.photoId)
        .eq('owner_id', userId)
        .maybeSingle();
      if (photoError) throw photoError;
      if (!photo) throw new RequestError('photo_not_found', 404);
      fromDetection = itemColumnsFromDetection(photo.detections, garmentSource.garmentIndex, photo.id);
      if (!fromDetection) throw new RequestError('garment_not_found', 409);
      // One item per detected garment: a retry or double tap must not save the same garment twice.
      const { count, error: dupError } = await admin
        .from('clothing_items')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', userId)
        .eq('source_photo_id', photo.id)
        .eq('source_box', JSON.stringify(fromDetection.source_box));
      if (dupError) throw dupError;
      if ((count ?? 0) > 0) throw new RequestError('garment_already_saved', 409);
    }

    if (target === 'wardrobe_photo') {
      // The original outfit photo: kept as taken (no background removal), one row in wardrobe_photos.
      const [clean, thumb] = await Promise.all([
        download(admin, source.clean, LIMITS.clean),
        download(admin, source.thumb, LIMITS.thumb),
      ]);
      const photoId = crypto.randomUUID();
      const imagePath = `${userId}/photos/${photoId}/clean.${EXT[clean.format]}`;
      const thumbPath = `${userId}/photos/${photoId}/thumb.${EXT[thumb.format]}`;
      for (const [path, photo] of [[imagePath, clean], [thumbPath, thumb]] as const) {
        const { error } = await admin.storage
          .from(PHOTOS)
          .upload(path, photo.bytes, { contentType: MIME[photo.format], upsert: false });
        if (error) throw error;
        written.push(path);
      }
      const { error: insertError } = await admin.from('wardrobe_photos').insert({
        id: photoId,
        owner_id: userId,
        image_path: imagePath,
        thumb_path: thumbPath,
        faces_blurred_at: facesBlurredAt(body?.face_check),
      });
      if (insertError) throw insertError;
      console.log(JSON.stringify({ event: 'process-image.face_check', photo_id: photoId, face_check: faceCheckLabel(body?.face_check) }));
      return json({ photo_id: photoId });
    }

    const [clean, thumb] = await Promise.all([
      download(admin, source.clean, LIMITS.clean).then((photo) => removeBackground(admin, userId, photo)),
      download(admin, source.thumb, LIMITS.thumb),
    ]);

    const itemId = crypto.randomUUID();
    const imagePath = `${userId}/${itemId}/clean.${EXT[clean.format]}`;
    const thumbPath = `${userId}/${itemId}/thumb.${EXT[thumb.format]}`;
    for (const [path, photo] of [[imagePath, clean], [thumbPath, thumb]] as const) {
      const { error } = await admin.storage
        .from(PHOTOS)
        .upload(path, photo.bytes, { contentType: MIME[photo.format], upsert: false });
      if (error) throw error;
      written.push(path);
    }

    const { error: insertError } = await admin
      .from('clothing_items')
      .insert({
        id: itemId,
        owner_id: userId,
        image_path: imagePath,
        thumb_path: thumbPath,
        faces_blurred_at: facesBlurredAt(body?.face_check),
        ...(fromDetection ?? {}),
      });
    if (insertError) throw insertError;
    // One line per upload, to see how often the device step runs and finds faces (never logs the raw value).
    console.log(JSON.stringify({ event: 'process-image.face_check', item_id: itemId, face_check: faceCheckLabel(body?.face_check) }));

    return json({ item_id: itemId });
  } catch (e) {
    // Don't leave photos without a row behind.
    if (written.length > 0) {
      const { error } = await admin.storage.from(PHOTOS).remove(written);
      if (error) console.error('process-image: cleanup failed', written, error);
    }
    if (e instanceof RequestError) return json({ error: e.code }, e.status);
    console.error('process-image failed', e);
    return json({ error: 'processing_failed' }, 500);
  } finally {
    // The quarantine copies are never kept, whether processing worked or not.
    const { error } = await admin.storage.from(QUARANTINE).remove([source.clean, source.thumb]);
    if (error) console.error('process-image: quarantine delete failed', error);
  }
});
