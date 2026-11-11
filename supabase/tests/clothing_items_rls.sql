-- RLS, grant and constraint checks for public.clothing_items and the photo buckets.
-- Safe on the shared database: runs in a transaction that is rolled back. Every outcome should be "good"
-- (or the expected value in the test name).
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-a@example.invalid', '{}', now(), now()),
       ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-b@example.invalid', '{}', now(), now());
insert into public.clothing_items (id, owner_id, category, subcategory, colours)
values ('00000000-0000-4000-8000-00000000b0b1', '00000000-0000-4000-8000-0000000000b2', 'top', 'shirt', '{white}');

create temp table results (test text, outcome text) on commit drop;
grant all on results to authenticated, anon;

create function pg_temp.expect_error(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into results values (label, 'ALLOWED (bad)');
exception when others then
  insert into results values (label, 'blocked (good): ' || sqlstate);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

insert into public.clothing_items (category, subcategory, colours, materials, seasons, formality)
values ('bottom', 'jeans', '{denim_blue}', '{denim}', '{spring,autumn}', 2);
insert into results select 'A insert own, owner defaults to A (expect 1)', count(*)::text from public.clothing_items where owner_id = '00000000-0000-4000-8000-0000000000a1';
insert into results select 'A sees only own rows (expect 1)', count(*)::text from public.clothing_items;
update public.clothing_items set brand = 'Hacked' where id = '00000000-0000-4000-8000-00000000b0b1';
delete from public.clothing_items where id = '00000000-0000-4000-8000-00000000b0b1';
update public.clothing_items set brand = 'Acne', tags_confirmed_at = now() where owner_id = '00000000-0000-4000-8000-0000000000a1';
insert into results select 'A updates own (expect Acne)', brand from public.clothing_items where owner_id = '00000000-0000-4000-8000-0000000000a1';

select pg_temp.expect_error('A insert for B', $q$insert into public.clothing_items (owner_id) values ('00000000-0000-4000-8000-0000000000b2')$q$);
select pg_temp.expect_error('A sets image_path', $q$update public.clothing_items set image_path = 'x' where owner_id = auth.uid()$q$);
select pg_temp.expect_error('A sets status sold', $q$update public.clothing_items set status = 'sold' where owner_id = auth.uid()$q$);
select pg_temp.expect_error('bad subcategory for category', $q$insert into public.clothing_items (category, subcategory) values ('top', 'jeans')$q$);
select pg_temp.expect_error('subcategory without category', $q$insert into public.clothing_items (subcategory) values ('jeans')$q$);
select pg_temp.expect_error('unknown colour', $q$insert into public.clothing_items (colours) values ('{neon}')$q$);
select pg_temp.expect_error('null in colours', $q$insert into public.clothing_items (colours) values (array[null]::text[])$q$);
select pg_temp.expect_error('formality 6', $q$insert into public.clothing_items (formality) values (6)$q$);
select pg_temp.expect_error('A uploads to B folder', $q$insert into storage.objects (bucket_id, name) values ('uploads-quarantine', '00000000-0000-4000-8000-0000000000b2/x.jpg')$q$);
select pg_temp.expect_error('A writes item-photos directly', $q$insert into storage.objects (bucket_id, name) values ('item-photos', '00000000-0000-4000-8000-0000000000a1/i/clean.webp')$q$);
insert into storage.objects (bucket_id, name) values ('uploads-quarantine', '00000000-0000-4000-8000-0000000000a1/u1.jpg');
insert into results select 'A uploads own quarantine, cannot read it back (expect 0)', count(*)::text from storage.objects where bucket_id = 'uploads-quarantine';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect_error('anon reads items', $q$select 1 from public.clothing_items$q$);

reset role;
insert into results select 'B row untouched (expect white, no brand)', array_to_string(colours, ',') || coalesce(' ' || brand, '') from public.clothing_items where id = '00000000-0000-4000-8000-00000000b0b1';
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a1';
insert into results select 'items cascade on user delete (expect 0)', count(*)::text from public.clothing_items where owner_id = '00000000-0000-4000-8000-0000000000a1';
select * from results;
rollback;
