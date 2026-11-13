-- M1c-4: cost log for AI calls + the "faces blurred" marker the tag-item privacy check reads.

-- One row per Vertex AI call (also failed ones). Written only by Edge Functions (service role).
-- Owners read totals in the dashboard; users can read (and export) their own rows.
-- Deleted with the account (cascade).
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade, -- null for system calls (health check)
  feature text not null check (char_length(feature) <= 40),
  model text not null check (char_length(model) <= 80),
  location text not null check (char_length(location) <= 40),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  est_cost_usd numeric(12, 8),
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.ai_usage is 'AI cost log, one row per provider call. Server-written; owner can read own rows.';

create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);
create index ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;

create policy "ai_usage: owner can read"
  on public.ai_usage for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- Set by the server (process-image) once faces in the cleaned photo were blurred. tag-item only sends a photo to
-- the AI if this is set or the user turned on "Let AI see faces" (profiles.consent_face_analysis).
-- Not in the client column grants, so users can't set it themselves.
alter table public.clothing_items add column faces_blurred_at timestamptz;
