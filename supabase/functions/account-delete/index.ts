// GDPR delete: permanently removes the signed-in user's account and everything they own.
// Order: storage files under {user_id}/ in every bucket → auth user (rows cascade via owner foreign keys).
// Rules for shared data (api_usage, messages, listings) are in docs/architecture.md and get added here
// when those tables exist.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== 'DELETE') return json({ error: 'confirmation_required' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);
  const userId = auth.user.id;

  const admin = createClient(url, serviceKey);
  try {
    // 1. Photos and other files.
    let filesRemoved = 0;
    const { data: buckets } = await admin.storage.listBuckets();
    for (const bucket of buckets ?? []) {
      const paths = await listAll(admin, bucket.name, userId);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await admin.storage.from(bucket.name).remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
      filesRemoved += paths.length;
    }

    // 2. The account itself; profiles and other owned rows cascade.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;

    console.log(`account-delete: removed user ${userId} and ${filesRemoved} files`);
    return json({ deleted: true, files_removed: filesRemoved });
  } catch (e) {
    console.error('account-delete failed', e);
    return json({ error: 'delete_failed' }, 500);
  }
});
