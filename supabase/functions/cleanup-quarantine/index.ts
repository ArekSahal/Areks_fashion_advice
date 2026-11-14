// Hourly cleanup of uploads-quarantine (issue #27). process-image deletes its quarantine copies, but files stay
// behind when the app uploads and never calls it (app closed, network dropped, only one of clean/thumb uploaded).
// Clients can't read or delete in that bucket, so this job removes every file older than 1 hour.
//
// Called only by the pg_cron job "cleanup-quarantine" (migration *_quarantine_cleanup_cron.sql) through pg_net.
// The gateway JWT check is off (the cron job has no user JWT); instead the caller must send the header
// x-cleanup-secret, which must match the Vault secret "quarantine_cleanup_secret". The check runs in the
// database (public.quarantine_cleanup_secret_ok, executable by service_role only), so the secret never needs to
// be copied into an Edge Function secret or the repo.
//
// Files are deleted through the Storage API (remove()), so the stored objects go too, not only the rows.
// Response/log: { removed, scanned, kept }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  MAX_AGE_MS,
  type QuarantineFile,
  type StorageListEntry,
  isFolder,
  joinPath,
  selectExpired,
  toBatches,
} from '../_shared/quarantine-cleanup.ts';

const QUARANTINE = 'uploads-quarantine';
const PAGE = 1000;

type Admin = ReturnType<typeof createClient>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Lists every file under prefix (recursively, all pages) with its created_at. Throws on errors.
async function listAll(admin: Admin, prefix: string): Promise<QuarantineFile[]> {
  const out: QuarantineFile[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(QUARANTINE).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    const entries = (data ?? []) as StorageListEntry[];
    for (const entry of entries) {
      const path = joinPath(prefix, entry.name);
      if (isFolder(entry)) out.push(...(await listAll(admin, path)));
      else out.push({ path, createdAt: entry.created_at });
    }
    if (entries.length < PAGE) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = req.headers.get('x-cleanup-secret') ?? '';
  if (secret.length < 32) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: ok, error: authError } = await admin.rpc('quarantine_cleanup_secret_ok', { p_secret: secret });
  if (authError) {
    console.error('cleanup-quarantine: secret check failed', authError.message);
    return json({ error: 'auth_check_failed' }, 500);
  }
  if (ok !== true) return json({ error: 'unauthorized' }, 401);

  try {
    const files = await listAll(admin, '');
    const expired = selectExpired(files, new Date(), MAX_AGE_MS);
    let removed = 0;
    for (const batch of toBatches(expired)) {
      const { data, error } = await admin.storage.from(QUARANTINE).remove(batch);
      if (error) throw error;
      removed += data?.length ?? 0;
    }
    const result = { removed, scanned: files.length, kept: files.length - expired.length };
    console.log(`cleanup-quarantine: removed ${removed} of ${files.length} files (${result.kept} younger than 1h)`);
    return json(result);
  } catch (e) {
    console.error('cleanup-quarantine failed', e instanceof Error ? e.message : e);
    return json({ error: 'cleanup_failed' }, 500);
  }
});
