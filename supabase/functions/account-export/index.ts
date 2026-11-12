// GDPR export: returns everything Cloey stores about the signed-in user as JSON.
// Tables are read with the user's own token (RLS applies); photos are listed with 7-day signed links.
// When a new user-owned table or bucket is added, add it to USER_TABLES / the bucket loop (Platform review checks this).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// table → column that holds the owner's user id
const USER_TABLES: Record<string, string> = {
  profiles: 'id',
  clothing_items: 'owner_id',
  ai_usage: 'user_id',
};

const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Lists every file under prefix (recursively, all pages). Throws on errors so nothing is silently skipped.
async function listAll(admin: ReturnType<typeof createClient>, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) out.push(...(await listAll(admin, bucket, path))); // folder
      else out.push(path);
    }
    if (!data || data.length < PAGE) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);
  const user = auth.user;

  try {
    const tables: Record<string, unknown[]> = {};
    for (const [table, ownerColumn] of Object.entries(USER_TABLES)) {
      const { data, error } = await userClient.from(table).select('*').eq(ownerColumn, user.id);
      if (error) throw error;
      tables[table] = data ?? [];
    }

    // Storage: every bucket uses {user_id}/… paths (docs/architecture.md).
    const admin = createClient(url, serviceKey);
    const files: { bucket: string; path: string; url: string | null }[] = [];
    const { data: buckets } = await admin.storage.listBuckets();
    for (const bucket of buckets ?? []) {
      for (const path of await listAll(admin, bucket.name, user.id)) {
        const { data } = await admin.storage.from(bucket.name).createSignedUrl(path, SIGNED_URL_SECONDS);
        files.push({ bucket: bucket.name, path, url: data?.signedUrl ?? null });
      }
    }

    return json({
      format: 'cloey-export/1',
      exported_at: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      tables,
      files,
      notes: 'Photo links expire after 7 days. Export again for fresh links.',
    });
  } catch (e) {
    console.error('account-export failed', e);
    return json({ error: 'export_failed' }, 500);
  }
});
