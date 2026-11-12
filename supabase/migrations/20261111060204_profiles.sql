-- M1a: user profiles (one row per auth user), created automatically on sign-up.

-- Shared helper: keep updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  -- Optional, only used to filter shop results (never inferred from photos).
  shopping_preference text check (shopping_preference in ('menswear', 'womenswear', 'both')),
  -- Faces are blurred before any AI call unless this is true.
  consent_face_analysis boolean not null default false,
  consent_face_analysis_at timestamptz,
  style_unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per user. Owner-only via RLS. Deleted with the auth user.';

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: owner can update"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No insert/delete policies: rows are created by the trigger below and removed by the auth.users cascade.

-- Users may only change their own editable fields; server-managed columns are protected.
revoke update on public.profiles from authenticated;
grant update (display_name, shopping_preference, consent_face_analysis) on public.profiles to authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Record when face-analysis consent was given or withdrawn.
create or replace function public.profiles_track_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.consent_face_analysis is distinct from old.consent_face_analysis then
    new.consent_face_analysis_at = now();
  end if;
  return new;
end;
$$;

create trigger profiles_track_consent
  before update on public.profiles
  for each row execute function public.profiles_track_consent();

-- Create a profile for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(new.raw_user_meta_data ->> 'display_name', 60), ''));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
