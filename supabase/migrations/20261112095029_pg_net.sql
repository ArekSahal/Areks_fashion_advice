-- pg_net lets SQL call Edge Functions (net.http_post). Used for server-side smoke checks of deployed functions
-- (agents can't reach *.supabase.co over HTTP, so they call functions from SQL and read net._http_response),
-- and later for scheduled jobs. Supabase installs its objects in the "net" schema.
create extension if not exists pg_net with schema extensions;
