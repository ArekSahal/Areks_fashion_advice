-- RLS + trigger checks for public.profiles. Safe on the shared database: everything runs in a transaction
-- that is rolled back. Run with the Supabase MCP execute_sql tool or `psql -f`. Every outcome should be "good"
-- (or the expected value noted in the test name).
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-a@example.invalid', '{"display_name":"Test A"}', now(), now()),
       ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-b@example.invalid', '{}', now(), now());

create temp table results (test text, outcome text) on commit drop;
grant all on results to authenticated;
insert into results select 'trigger created profiles (expect 2)', count(*)::text from public.profiles where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b2');
insert into results select 'display_name from metadata (expect Test A)', display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000a1';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

insert into results select 'A sees rows (expect 1)', count(*)::text from public.profiles;
update public.profiles set display_name = 'Renamed', consent_face_analysis = true where id = '00000000-0000-4000-8000-0000000000a1';
insert into results select 'A updated own (expect Renamed consent_at_set=true)', display_name || ' consent_at_set=' || (consent_face_analysis_at is not null) from public.profiles where id = '00000000-0000-4000-8000-0000000000a1';
update public.profiles set display_name = 'Hacked' where id = '00000000-0000-4000-8000-0000000000b2';

do $$ begin
  begin
    update public.profiles set style_unlocked_at = now() where id = '00000000-0000-4000-8000-0000000000a1';
    insert into results values ('A update protected column', 'ALLOWED (bad)');
  exception when insufficient_privilege then
    insert into results values ('A update protected column', 'blocked (good)');
  end;
  begin
    insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000000c3');
    insert into results values ('A insert profile', 'ALLOWED (bad)');
  exception when insufficient_privilege then
    insert into results values ('A insert profile', 'blocked (good)');
  end;
end $$;

reset role;
insert into results select 'B untouched by A (expect null)', coalesce(display_name, '(null, untouched)') from public.profiles where id = '00000000-0000-4000-8000-0000000000b2';
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a1';
insert into results select 'profile cascades on user delete (expect 0)', count(*)::text from public.profiles where id = '00000000-0000-4000-8000-0000000000a1';
select * from results;
rollback;
