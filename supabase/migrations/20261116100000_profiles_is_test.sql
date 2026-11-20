-- #35: mark seeded test accounts so they can be excluded from metrics and from anything shown to other users.
-- Not in the authenticated column grants, so a user can read their own flag but never change it.
alter table public.profiles
  add column is_test boolean not null default false;

comment on column public.profiles.is_test is
  'Seeded test account (#35). Exclude from metrics, cost-per-user numbers and other users'' views.';

-- The seed script creates test users with app_metadata.is_test = true (only the service role can set app_metadata),
-- so the flag is written in the same step as the user and a half-finished run can't leave an unflagged account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, is_test)
  values (
    new.id,
    nullif(left(new.raw_user_meta_data ->> 'display_name', 60), ''),
    coalesce(new.raw_app_meta_data ->> 'is_test', '') = 'true'
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
