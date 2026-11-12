-- pg_net lets SQL call Edge Functions (net.http_post). Used by agents to run the vertex-check health check
-- from the SQL editor/MCP, and later for scheduled jobs. Supabase installs its objects in the "net" schema.
create extension if not exists pg_net with schema extensions;
