-- M1c-4 review (Platform): one shared cost log for every paid API (Vertex, Channel3, Photoroom) instead of an
-- AI-only table, as described in docs/architecture.md. Rows survive account delete with user_id set to null so
-- aggregate cost stays correct. The table only held health-check rows when this ran (no user data).
alter table public.ai_usage rename to api_usage;
alter index public.ai_usage_pkey rename to api_usage_pkey;
alter index public.ai_usage_user_created_idx rename to api_usage_user_created_idx;
alter index public.ai_usage_created_idx rename to api_usage_created_idx;
alter table public.api_usage rename constraint ai_usage_feature_check to api_usage_feature_check;
alter table public.api_usage rename constraint ai_usage_model_check to api_usage_model_check;
alter table public.api_usage rename constraint ai_usage_location_check to api_usage_location_check;
alter table public.api_usage rename constraint ai_usage_input_tokens_check to api_usage_input_tokens_check;
alter table public.api_usage rename constraint ai_usage_output_tokens_check to api_usage_output_tokens_check;
alter table public.api_usage add column provider text not null default 'vertex'
  check (provider in ('vertex', 'channel3', 'photoroom'));
alter table public.api_usage alter column provider drop default;
alter table public.api_usage add column units numeric(14, 2) not null default 0 check (units >= 0);
alter table public.api_usage add column unit text not null default 'tokens'
  check (unit in ('tokens', 'credits', 'calls'));
alter table public.api_usage alter column unit drop default;
update public.api_usage set units = input_tokens + output_tokens;
alter table public.api_usage rename column est_cost_usd to cost_estimate_usd;
alter table public.api_usage alter column model drop not null;
alter table public.api_usage alter column location drop not null;
alter table public.api_usage drop constraint ai_usage_user_id_fkey;
alter table public.api_usage add constraint api_usage_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;
alter policy "ai_usage: owner can read" on public.api_usage rename to "api_usage: owner can read";
comment on table public.api_usage is
  'Cost log, one row per paid API call (also failed ones). Server-written; owner can read own rows; user_id set to null on account delete.';
