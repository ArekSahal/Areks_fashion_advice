-- RLS and grant checks for the M1.5 Shop cache tables (public.external_products, public.channel3_search_cache).
-- Both are server-only: signed-in and anonymous clients can't read or write them.
-- Safe on the shared database: runs in a transaction that is rolled back. Paste the whole file into the Supabase
-- SQL Editor (or the MCP execute_sql tool) and run it; the results appear as an error message. Every outcome
-- should be "good".
begin;
insert into public.external_products (external_id, title) values ('rlsTest1', 'RLS test product');
insert into public.channel3_search_cache (cache_key, product_ids) values (repeat('a', 64), '{rlsTest1}');

create temp table results (test text, outcome text) on commit drop;
grant all on results to authenticated, anon;

create function pg_temp.expect_error(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into results values (label, 'ALLOWED (bad)');
exception when others then
  insert into results values (label, 'blocked (good): ' || sqlstate);
end $$;

grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select pg_temp.expect_error('authenticated: read external_products', 'select * from public.external_products');
select pg_temp.expect_error('authenticated: write external_products', $q$insert into public.external_products (external_id, title) values ('x', 'x')$q$);
select pg_temp.expect_error('authenticated: read search cache', 'select * from public.channel3_search_cache');
select pg_temp.expect_error('authenticated: write search cache', $q$delete from public.channel3_search_cache$q$);

reset role;
set local role anon;
select pg_temp.expect_error('anon: read external_products', 'select * from public.external_products');
select pg_temp.expect_error('anon: read search cache', 'select * from public.channel3_search_cache');

reset role;
select pg_temp.expect_error('url check rejects http images', $q$insert into public.external_products (external_id, title, image_url) values ('rlsTest2', 't', 'http://x')$q$);
select pg_temp.expect_error('cache key must be a sha256 hex', $q$insert into public.channel3_search_cache (cache_key, product_ids) values ('nothex', '{}')$q$);

-- Show the results as an error on purpose: the error aborts the transaction, so nothing above is kept.
do $$ declare r text;
begin
  select string_agg(test || ': ' || outcome, E'\n') into r from results;
  raise exception E'TEST RESULTS (everything rolled back, look for "bad"):\n%', r;
end $$;
rollback;
