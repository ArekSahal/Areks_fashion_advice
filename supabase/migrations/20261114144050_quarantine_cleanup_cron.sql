-- Hourly cleanup of uploads-quarantine (issue #27): pg_cron calls the cleanup-quarantine Edge Function through
-- pg_net, which removes files older than 1 hour via the Storage API.
--
-- Auth: the function's gateway JWT check is off, so the cron job sends a shared secret in x-cleanup-secret.
-- The secret is generated here, at apply time, and lives only in Supabase Vault ("quarantine_cleanup_secret");
-- nothing secret is in this file. The function checks it with quarantine_cleanup_secret_ok(), which only
-- service_role can execute. Rotate with:
--   select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
--   from vault.secrets where name = 'quarantine_cleanup_secret';
-- Note: the URL below is the production project. On a local `supabase start` the job calls production with a
-- different random secret and gets 401, which is harmless.

create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'quarantine_cleanup_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'quarantine_cleanup_secret',
      'Shared secret between the cleanup-quarantine cron job and Edge Function (issue #27)'
    );
  end if;
end
$$;

create or replace function public.quarantine_cleanup_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ds.decrypted_secret = p_secret
       from vault.decrypted_secrets ds
      where ds.name = 'quarantine_cleanup_secret'),
    false
  ) and length(coalesce(p_secret, '')) >= 32;
$$;

comment on function public.quarantine_cleanup_secret_ok(text) is
  'Used by the cleanup-quarantine Edge Function to verify its caller. service_role only.';

revoke all on function public.quarantine_cleanup_secret_ok(text) from public, anon, authenticated;
grant execute on function public.quarantine_cleanup_secret_ok(text) to service_role;

select cron.schedule(
  'cleanup-quarantine',
  '17 * * * *',
  $job$
  select net.http_post(
    url := 'https://emnkjfoccluygilkebbz.supabase.co/functions/v1/cleanup-quarantine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'quarantine_cleanup_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
