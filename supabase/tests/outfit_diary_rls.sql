-- RLS, grant, same-owner and cascade checks for the outfit diary (public.outfits, public.outfit_items and the view
-- public.item_wear_stats), #56.
-- Safe on the shared database: runs in a transaction that is rolled back. Paste the whole file into the Supabase
-- SQL Editor and press Run; the results appear as an error message. Every outcome should be "good"
-- (or the expected value in the test name).
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-a@example.invalid', '{}', now(), now()),
       ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-b@example.invalid', '{}', now(), now());
-- Items and photos are created by the server (process-image), so set them up as the table owner.
insert into public.clothing_items (id, owner_id, category, subcategory)
values ('00000000-0000-4000-8000-00000000a0a1', '00000000-0000-4000-8000-0000000000a1', 'top', 'shirt'),
       ('00000000-0000-4000-8000-00000000a0a2', '00000000-0000-4000-8000-0000000000a1', 'bottom', 'jeans'),
       ('00000000-0000-4000-8000-00000000b0b1', '00000000-0000-4000-8000-0000000000b2', 'top', 't_shirt');
insert into public.wardrobe_photos (id, owner_id)
values ('00000000-0000-4000-8000-00000000a9a9', '00000000-0000-4000-8000-0000000000a1'),
       ('00000000-0000-4000-8000-00000000b9b9', '00000000-0000-4000-8000-0000000000b2');
insert into public.outfits (id, owner_id, worn_on)
values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-0000000000b2', current_date);
insert into public.outfit_items (outfit_id, item_id, owner_id)
values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-00000000b0b1', '00000000-0000-4000-8000-0000000000b2');

create temp table results (test text, outcome text) on commit drop;
grant all on results to authenticated, anon;

create function pg_temp.expect_error(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into results values (label, 'ALLOWED (bad)');
exception when others then
  insert into results values (label, 'blocked (good): ' || sqlstate);
end $$;

create function pg_temp.expect_ok(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into results values (label, 'ok (good)');
exception when others then
  insert into results values (label, 'FAILED (bad): ' || sqlstate || ' ' || sqlerrm);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- A posts two outfits today (outfit change) and one yesterday. Ids come back through select (clients can't set id).
select pg_temp.expect_ok('A posts outfit with own photo + occasion',
  $q$insert into public.outfits (worn_on, photo_id, occasion, notes) values (current_date, '00000000-0000-4000-8000-00000000a9a9', 'work', 'morning')$q$);
select pg_temp.expect_ok('A posts a second outfit the same day',
  $q$insert into public.outfits (worn_on, occasion, notes) values (current_date, 'evening', 'evening')$q$);
select pg_temp.expect_ok('A posts yesterday',
  $q$insert into public.outfits (worn_on, notes) values (current_date - 1, 'yesterday')$q$);
select pg_temp.expect_ok('A links own items',
  $q$insert into public.outfit_items (outfit_id, item_id)
     select o.id, i.id from public.outfits o cross join public.clothing_items i
     where (o.notes in ('morning', 'evening') and i.id = '00000000-0000-4000-8000-00000000a0a1')
        or (o.notes = 'yesterday')$q$);
insert into results select 'A owner defaults to A (expect 3)', count(*)::text from public.outfits where owner_id = '00000000-0000-4000-8000-0000000000a1';
insert into results select 'A sees only own outfits (expect 3)', count(*)::text from public.outfits;
insert into results select 'A sees only own links (expect 4)', count(*)::text from public.outfit_items;
insert into results select 'view shows only own items (expect 2)', count(*)::text from public.item_wear_stats;
insert into results select 'two entries same day = one wear day; shirt (expect 2 ' || current_date || ')', wear_count || ' ' || last_worn_on
  from public.item_wear_stats where item_id = '00000000-0000-4000-8000-00000000a0a1';
insert into results select 'jeans worn yesterday only (expect 1 ' || (current_date - 1) || ')', wear_count || ' ' || last_worn_on
  from public.item_wear_stats where item_id = '00000000-0000-4000-8000-00000000a0a2';

select pg_temp.expect_error('A links B item', $q$insert into public.outfit_items (outfit_id, item_id)
  select id, '00000000-0000-4000-8000-00000000b0b1' from public.outfits where notes = 'yesterday'$q$);
select pg_temp.expect_error('A links own item into B outfit', $q$insert into public.outfit_items (outfit_id, item_id)
  values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-00000000a0a2')$q$);
select pg_temp.expect_error('A posts with B photo', $q$insert into public.outfits (worn_on, photo_id) values (current_date, '00000000-0000-4000-8000-00000000b9b9')$q$);
select pg_temp.expect_error('A moves own outfit to B photo', $q$update public.outfits set photo_id = '00000000-0000-4000-8000-00000000b9b9' where notes = 'yesterday'$q$);
select pg_temp.expect_error('A sets owner_id on insert', $q$insert into public.outfits (owner_id, worn_on) values ('00000000-0000-4000-8000-0000000000b2', current_date)$q$);
select pg_temp.expect_error('A changes owner_id', $q$update public.outfits set owner_id = '00000000-0000-4000-8000-0000000000b2'$q$);
select pg_temp.expect_error('A sets owner_id on a link', $q$insert into public.outfit_items (outfit_id, item_id, owner_id)
  values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-00000000b0b1', '00000000-0000-4000-8000-0000000000b2')$q$);
select pg_temp.expect_error('A updates a link', $q$update public.outfit_items set item_id = '00000000-0000-4000-8000-00000000a0a2'$q$);
select pg_temp.expect_error('unknown occasion', $q$insert into public.outfits (worn_on, occasion) values (current_date, 'gala')$q$);
select pg_temp.expect_error('worn two days ahead', $q$insert into public.outfits (worn_on) values (current_date + 2)$q$);
select pg_temp.expect_ok('worn tomorrow (time zone slack)', $q$insert into public.outfits (worn_on, notes) values (current_date + 1, 'tz')$q$);
select pg_temp.expect_ok('A edits own outfit', $q$update public.outfits set occasion = 'party', notes = 'edited' where notes = 'tz'$q$);
update public.outfits set notes = 'Hacked' where id = '00000000-0000-4000-8000-00000000b0f1';
delete from public.outfits where id = '00000000-0000-4000-8000-00000000b0f1';
delete from public.outfit_items where outfit_id = '00000000-0000-4000-8000-00000000b0f1';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect_error('anon reads outfits', $q$select 1 from public.outfits$q$);
select pg_temp.expect_error('anon reads outfit_items', $q$select 1 from public.outfit_items$q$);
select pg_temp.expect_error('anon reads item_wear_stats', $q$select 1 from public.item_wear_stats$q$);

reset role;
insert into results select 'B outfit and link untouched (expect 1 link, no notes)', count(oi.*) || coalesce(' ' || o.notes, '')
  from public.outfits o left join public.outfit_items oi on oi.outfit_id = o.id
  where o.id = '00000000-0000-4000-8000-00000000b0f1' group by o.notes;
select pg_temp.expect_error('server cannot cross owners either', $q$insert into public.outfit_items (outfit_id, item_id, owner_id)
  select id, '00000000-0000-4000-8000-00000000b0b1', owner_id from public.outfits where notes = 'yesterday'$q$);

delete from public.wardrobe_photos where id = '00000000-0000-4000-8000-00000000a9a9';
insert into results select 'photo delete keeps outfit, clears photo_id (expect morning null)', notes || ' ' || coalesce(photo_id::text, 'null')
  from public.outfits where notes = 'morning';
delete from public.clothing_items where id = '00000000-0000-4000-8000-00000000a0a1';
insert into results select 'item delete removes its links (expect 1)', count(*)::text from public.outfit_items where owner_id = '00000000-0000-4000-8000-0000000000a1';
delete from public.outfits where notes = 'yesterday';
insert into results select 'outfit delete removes its links (expect 0)', count(*)::text from public.outfit_items where owner_id = '00000000-0000-4000-8000-0000000000a1';
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a1';
insert into results select 'outfits cascade on user delete (expect 0)', count(*)::text from public.outfits where owner_id = '00000000-0000-4000-8000-0000000000a1';
-- Show the results as an error on purpose: the error aborts the transaction, so nothing above is kept,
-- and the Supabase SQL Editor shows the message even though it only displays the last statement.
do $$ declare r text;
begin
  select string_agg(test || ': ' || outcome, E'\n') into r from results;
  raise exception E'TEST RESULTS (everything rolled back, look for "bad"):\n%', r;
end $$;
rollback;
