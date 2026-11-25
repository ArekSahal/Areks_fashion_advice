// Test accounts with a filled wardrobe (#35). Run by .github/workflows/seed-test-accounts.yml:
//
//   node --experimental-strip-types scripts/seed/seed-test-accounts.ts pick <out.json>
//     Searches Unsplash (UNSPLASH_ACCESS_KEY) and writes a draft photo list plus a review table to the job summary.
//     An owner removes every photo that shows a face, fills in reviewed_by and commits it as scripts/seed/photos.json.
//
//   node --experimental-strip-types scripts/seed/seed-test-accounts.ts seed
//     Creates the 3 test accounts or empties them (refusing any account not marked profiles.is_test), then adds each
//     photo through the normal pipeline: device-style re-encode → uploads-quarantine → process-image → tag-item →
//     confirm the suggested tags. Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//     SEED_ACCOUNT_PASSWORD; UNSPLASH_ACCESS_KEY is optional (used to count downloads, as Unsplash's API terms ask).
//
// sharp is installed by the workflow only (npm i --no-save), so it is not an app dependency.
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { missingFields, suggestionFromResponse, toConfirmedUpdate } from '../../src/lib/confirmTags.ts';
import {
  PICK_QUERIES,
  SEED_ACCOUNTS,
  assertTestAccount,
  fromUnsplash,
  parseManifest,
  photosForAccount,
  reviewSummary,
  uniquePhotos,
  type ManifestPhoto,
  type SeedAccount,
} from '../../src/lib/seedAccounts.ts';

const UA = 'cloey-seed-script';

function env(name: string, required = true): string {
  const v = process.env[name] ?? '';
  if (required && !v) throw new Error(`Missing ${name}`);
  return v;
}

function summary(markdown: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
  else console.log(markdown);
}

// ---------- pick ----------

async function pick(outFile: string) {
  const key = env('UNSPLASH_ACCESS_KEY');
  const found: ManifestPhoto[] = [];
  for (const { query, wardrobe } of PICK_QUERIES) {
    const url = new URL('https://api.unsplash.com/search/photos');
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', '8');
    url.searchParams.set('content_filter', 'high');
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1', 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Unsplash search "${query}" failed: ${res.status}`);
    const body = (await res.json()) as { results?: unknown[] };
    for (const r of body.results ?? []) {
      const photo = fromUnsplash(r, wardrobe, query);
      if (photo) found.push(photo);
    }
  }
  const photos = uniquePhotos(found);
  writeFileSync(outFile, `${JSON.stringify({ version: 1, reviewed_by: '', photos }, null, 2)}\n`);
  summary(reviewSummary(photos));
  console.log(`Wrote ${photos.length} candidate photos to ${outFile}`);
}

// ---------- seed ----------

type Admin = SupabaseClient;

async function findUserId(admin: Admin, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  throw new Error('Too many users to search');
}

/** Every object under prefix in a bucket (storage.list is one level deep, so walk folders). */
async function listAll(admin: Admin, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  const out: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    // Folders come back without an id.
    if (entry.id) out.push(path);
    else out.push(...(await listAll(admin, bucket, path, depth + 1)));
  }
  return out;
}

/**
 * Creates the account, or empties an existing test account (photos and rows) and resets its password. The auth user
 * is kept on purpose: api_usage rows outlive a deleted user with user_id set to null, which would mix the seed's AI
 * cost into real users' numbers. Kept users stay filterable through profiles.is_test.
 */
async function createOrResetAccount(admin: Admin, account: SeedAccount, password: string): Promise<string> {
  let id = await findUserId(admin, account.email);
  if (id) {
    const { data: profile, error } = await admin.from('profiles').select('is_test').eq('id', id).maybeSingle();
    if (error) throw error;
    assertTestAccount(account.email, profile);
    for (const bucket of ['item-photos', 'uploads-quarantine']) {
      const paths = await listAll(admin, bucket, id);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmError } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (rmError) throw rmError;
      }
    }
    for (const table of ['clothing_items', 'wardrobe_photos']) {
      const { error: delError } = await admin.from(table).delete().eq('owner_id', id);
      if (delError) throw delError;
    }
    const { error: updError } = await admin.auth.admin.updateUserById(id, {
      password,
      user_metadata: { display_name: account.displayName },
    });
    if (updError) throw updError;
    console.log(`Emptied ${account.key}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: account.displayName },
      // Sets profiles.is_test in the sign-up trigger, in the same step as the user (see the migration).
      app_metadata: { is_test: true },
    });
    if (error || !data.user) throw error ?? new Error('createUser returned no user');
    id = data.user.id;
    console.log(`Created ${account.key}`);
  }
  // The photos were reviewed for faces, so this account allows AI on unblurred photos (no device blur runs here).
  // Note: consent also turns on Photoroom background removal in process-image (paid, capped at 50 calls per user per day).
  const { data: updated, error: profileError } = await admin
    .from('profiles')
    .update({ is_test: true, display_name: account.displayName, consent_face_analysis: true, shopping_preference: account.wardrobe })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (profileError) throw profileError;
  if (!updated) throw new Error(`No profile row for ${account.email}`);
  return id;
}

/** The bit of sharp we use. sharp is installed by the workflow only, so CI's typecheck can't see its types. */
type SharpChain = {
  rotate(): SharpChain;
  resize(w: number, h: number, o: { fit: 'inside'; withoutEnlargement: boolean }): SharpChain;
  webp(o: { quality: number }): SharpChain;
  toBuffer(): Promise<Buffer>;
};

async function prepare(bytes: Buffer) {
  const moduleName = 'sharp';
  const sharp = ((await import(moduleName)) as { default: (input: Buffer) => SharpChain }).default;
  // Same sizes and quality as the app (src/lib/photo.ts); sharp drops EXIF unless asked to keep it.
  const clean = await sharp(bytes).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  const thumb = await sharp(bytes).rotate().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  return { clean, thumb };
}

type Outcome = 'tagged' | 'needs_tags' | 'failed';

async function addItem(user: SupabaseClient, userId: string, photo: ManifestPhoto, unsplashKey: string): Promise<Outcome> {
  const res = await fetch(photo.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.warn(`  ${photo.id}: download failed (${res.status})`);
    return 'failed';
  }
  if (unsplashKey) {
    // Unsplash API terms: count a download when a photo is used. Best effort on purpose: a failed count must not
    // stop the seed.
    await fetch(photo.download_location, { headers: { Authorization: `Client-ID ${unsplashKey}`, 'User-Agent': UA } }).catch(() => undefined);
  }
  const { clean, thumb } = await prepare(Buffer.from(await res.arrayBuffer()));
  const uploadId = randomUUID();
  for (const [path, body] of [[`${userId}/${uploadId}.webp`, clean], [`${userId}/${uploadId}.thumb.webp`, thumb]] as const) {
    const { error } = await user.storage.from('uploads-quarantine').upload(path, body, { contentType: 'image/webp' });
    if (error) {
      console.warn(`  ${photo.id}: upload failed`, error.message);
      return 'failed';
    }
  }
  const processed = await user.functions.invoke<{ item_id: string }>('process-image', {
    body: { upload_id: uploadId, format: 'webp', face_check: 'skipped' },
  });
  const itemId = processed.data?.item_id;
  if (processed.error || !itemId) {
    console.warn(`  ${photo.id}: process-image failed`, processed.error?.message);
    return 'failed';
  }
  const tagged = await user.functions.invoke<unknown>('tag-item', { body: { item_id: itemId } });
  const suggestion = tagged.error ? null : suggestionFromResponse(tagged.data);
  // Like a user who accepts the suggestion. Anything incomplete stays "Needs tags", which is realistic too.
  if (!suggestion || missingFields(suggestion.tags).length > 0) return 'needs_tags';
  const { error } = await user.from('clothing_items').update(toConfirmedUpdate(suggestion.tags)).eq('id', itemId);
  return error ? 'needs_tags' : 'tagged';
}

async function seed() {
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const password = env('SEED_ACCOUNT_PASSWORD');
  if (password.length < 12) throw new Error('SEED_ACCOUNT_PASSWORD must be at least 12 characters');
  const unsplashKey = env('UNSPLASH_ACCESS_KEY', false);
  const manifest = parseManifest(JSON.parse(readFileSync(new URL('./photos.json', import.meta.url), 'utf8')));
  const started = new Date().toISOString();

  // Check every existing account before changing any, so a real account stops the run before anything is emptied.
  for (const account of SEED_ACCOUNTS) {
    const existing = await findUserId(admin, account.email);
    if (!existing) continue;
    const { data: profile, error } = await admin.from('profiles').select('is_test').eq('id', existing).maybeSingle();
    if (error) throw error;
    assertTestAccount(account.email, profile);
  }

  const rows: string[] = ['| Account | Items | Tagged | Needs tags | Failed |', '| --- | --- | --- | --- | --- |'];
  const ids: string[] = [];
  for (const account of SEED_ACCOUNTS) {
    const userId = await createOrResetAccount(admin, account, password);
    ids.push(userId);
    const user = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await user.auth.signInWithPassword({ email: account.email, password });
    if (signInError) throw signInError;

    const counts: Record<Outcome, number> = { tagged: 0, needs_tags: 0, failed: 0 };
    for (const photo of photosForAccount(manifest.photos, account.wardrobe)) {
      const outcome = await addItem(user, userId, photo, unsplashKey).catch((e) => {
        console.warn(`  ${photo.id}: failed`, e instanceof Error ? e.message : e);
        return 'failed' as const;
      });
      counts[outcome] += 1;
    }
    await user.auth.signOut();
    const items = counts.tagged + counts.needs_tags;
    console.log(`${account.key}: ${items} items (${counts.tagged} tagged, ${counts.needs_tags} need tags, ${counts.failed} failed)`);
    rows.push(`| ${account.email} | ${items} | ${counts.tagged} | ${counts.needs_tags} | ${counts.failed} |`);
  }

  // The real cost of this run, as logged by the functions themselves (api_usage).
  const { data: usage, error: usageError } = await admin
    .from('api_usage')
    .select('feature, cost_estimate_usd')
    .in('user_id', ids)
    .gte('created_at', started);
  const cost = usageError
    ? 'could not read api_usage'
    : `$${(usage ?? []).reduce((sum, r) => sum + Number(r.cost_estimate_usd ?? 0), 0).toFixed(2)} over ${(usage ?? []).length} logged calls`;
  summary(['## Test accounts seeded', '', ...rows, '', `AI cost of this run: ${cost}.`, '', 'Background removal (Photoroom) runs for these accounts and is capped at 50 calls per account per day, so a second run within 24 h may keep some backgrounds.', '', 'Outfit photos come in a later run (they need #53).'].join('\n'));
}

const [mode, arg] = process.argv.slice(2);
const run = mode === 'pick' ? pick(arg || 'photos.draft.json') : mode === 'seed' ? seed() : Promise.reject(new Error('Usage: pick <out.json> | seed'));
run.catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
