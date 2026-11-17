-- #56 slice 1 (M2): the outfit diary. Diary entries (`outfits`, several per day allowed, e.g. an evening change), the
-- items worn (`outfit_items`) and an optional outfit photo. The photo reuses `wardrobe_photos` (same upload / EXIF /
-- face-blur pipeline) instead of a second photo table or an outfit-photos bucket. Wear count and "last worn" are derived (`item_wear_stats`), never
-- stored, so they can't drift from the entries.
-- Same-owner rule: an entry may only point at the user's own photo and items. That is enforced with composite foreign
-- keys on (id, owner_id), so it holds for every role (also the service role and RLS-exempt Edge Functions), and a
-- failed check never reveals whether someone else's photo or item exists.
-- Additive only: previews and production share one database (docs/architecture.md).

-- Targets for the composite foreign keys. id is already unique, so these never reject an existing row.
alter table public.wardrobe_photos
  add constraint wardrobe_photos_id_owner_key unique (id, owner_id);
alter table public.clothing_items
  add constraint clothing_items_id_owner_key unique (id, owner_id);

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The user's local calendar day (the app sends it; the server's UTC date can be a day off in Sweden around midnight).
  -- Not in the future: a diary entry is something worn, not planned (+1 day for time zones ahead of UTC).
  worn_on date not null check (worn_on <= current_date + 1),
  -- Optional outfit photo. Deleting the photo keeps the entry and its items, only the photo link is cleared.
  photo_id uuid,
  -- What the outfit was for. Same values as clothing_items.occasions (src/lib/taxonomy.ts OCCASIONS).
  occasion text check (occasion in (
    'everyday', 'work', 'evening', 'party', 'wedding', 'sport', 'outdoor', 'travel', 'lounge'
  )),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outfits_id_owner_key unique (id, owner_id),
  constraint outfits_photo_same_owner_fkey foreign key (photo_id, owner_id)
    references public.wardrobe_photos (id, owner_id) on delete set null (photo_id)
);

comment on table public.outfits is
  'Outfit diary: what the user wore on a day (several entries per day allowed). Owner-only via RLS. Deleted with the auth user.';

create index outfits_owner_worn_on_idx on public.outfits (owner_id, worn_on desc);
create index outfits_photo_idx on public.outfits (photo_id) where photo_id is not null;

alter table public.outfits enable row level security;

create policy "outfits: owner can read"
  on public.outfits for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "outfits: owner can insert"
  on public.outfits for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "outfits: owner can update"
  on public.outfits for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "outfits: owner can delete"
  on public.outfits for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Column-level grants: owner_id comes from auth.uid() and never changes.
revoke all on public.outfits from anon;
revoke all on public.outfits from authenticated;
grant select, delete on public.outfits to authenticated;
grant insert (worn_on, photo_id, occasion, notes) on public.outfits to authenticated;
grant update (worn_on, photo_id, occasion, notes) on public.outfits to authenticated;

create trigger outfits_set_updated_at
  before update on public.outfits
  for each row execute function public.set_updated_at();

-- Items worn in a diary entry. owner_id is repeated here so both foreign keys can require the same owner.
-- Deleting the entry or the item removes the link (and so that wear).
create table public.outfit_items (
  outfit_id uuid not null,
  item_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (outfit_id, item_id),
  constraint outfit_items_outfit_same_owner_fkey foreign key (outfit_id, owner_id)
    references public.outfits (id, owner_id) on delete cascade,
  constraint outfit_items_item_same_owner_fkey foreign key (item_id, owner_id)
    references public.clothing_items (id, owner_id) on delete cascade
);

comment on table public.outfit_items is
  'Items worn in an outfit diary entry; entry and item must have the same owner. Owner-only via RLS.';

create index outfit_items_item_idx on public.outfit_items (item_id);
create index outfit_items_owner_item_idx on public.outfit_items (owner_id, item_id);

alter table public.outfit_items enable row level security;

create policy "outfit_items: owner can read"
  on public.outfit_items for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "outfit_items: owner can insert"
  on public.outfit_items for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "outfit_items: owner can delete"
  on public.outfit_items for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- No update: change the items of an entry by deleting and inserting links.
revoke all on public.outfit_items from anon;
revoke all on public.outfit_items from authenticated;
grant select, delete on public.outfit_items to authenticated;
grant insert (outfit_id, item_id) on public.outfit_items to authenticated;

-- Wear count and last worn per item, derived from the diary. wear_count counts distinct days, so an item in two entries
-- on the same day (outfit change) is one wear. Every item of the caller is listed (0 / null if never worn), which style analysis needs for "items never worn". security_invoker: the caller's RLS applies to every table
-- read here, so a user only ever sees their own items.
create view public.item_wear_stats
  with (security_invoker = true)
as
select
  ci.id as item_id,
  ci.owner_id,
  count(distinct o.worn_on)::integer as wear_count,
  max(o.worn_on) as last_worn_on
from public.clothing_items ci
left join public.outfit_items oi on oi.item_id = ci.id and oi.owner_id = ci.owner_id
left join public.outfits o on o.id = oi.outfit_id and o.owner_id = oi.owner_id
group by ci.id, ci.owner_id;

comment on view public.item_wear_stats is
  'Per item: on how many days it was logged in the outfit diary and the last day. Derived, security_invoker (owner-only via RLS).';

revoke all on public.item_wear_stats from anon;
revoke all on public.item_wear_stats from authenticated;
grant select on public.item_wear_stats to authenticated;
