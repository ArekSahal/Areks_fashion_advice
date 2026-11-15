-- M1.5 Shop (#34): Channel3 caches, following docs/channel3.md → Caching rules.
-- Both tables are server-only: RLS on with no policies and no client grants, so only the channel3-search Edge
-- Function (service role) reads and writes them. Neither table holds user data: search keys are hashes of the
-- normalised query + filters, shared by every user who searches the same thing.

-- Display fields of Channel3 products we have shown (7-day TTL) plus price/condition for ranking (24 h TTL).
-- The offer url (affiliate buy link) is never stored; the app gets it fresh from the function.
create table public.external_products (
  external_id text primary key check (external_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  title text not null check (char_length(title) <= 200),
  brand text check (char_length(brand) <= 200),
  image_url text check (image_url ~ '^https://'),
  category_slug text check (char_length(category_slug) <= 200),
  gender text check (gender in ('male', 'female')),
  materials text[] not null default '{}',
  price numeric(12, 2) check (price >= 0),
  currency text check (char_length(currency) <= 8),
  condition text check (condition in ('new', 'used')),
  offer_domain text check (char_length(offer_domain) <= 255),
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.external_products is
  'Channel3 product display fields (7 d) and ranking price (24 h). Never buy links. Server-only (no client access).';

create index external_products_refreshed_idx on public.external_products (refreshed_at);

-- Search results as ordered Channel3 product id lists, reused for 24 h (docs/channel3.md).
create table public.channel3_search_cache (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  product_ids text[] not null,
  created_at timestamptz not null default now()
);

comment on table public.channel3_search_cache is
  'sha256(normalised query + filters + locale) -> ordered Channel3 product ids, 24 h TTL. Server-only.';

create index channel3_search_cache_created_idx on public.channel3_search_cache (created_at);

alter table public.external_products enable row level security;
alter table public.channel3_search_cache enable row level security;

revoke all on public.external_products from anon, authenticated;
revoke all on public.channel3_search_cache from anon, authenticated;

-- Daily cleanup of expired rows (the function also ignores expired rows, so this only keeps the tables small).
create extension if not exists pg_cron;

select cron.schedule(
  'channel3-cache-cleanup',
  '17 3 * * *',
  $$
    delete from public.channel3_search_cache where created_at < now() - interval '2 days';
    delete from public.external_products where refreshed_at < now() - interval '7 days';
  $$
);
