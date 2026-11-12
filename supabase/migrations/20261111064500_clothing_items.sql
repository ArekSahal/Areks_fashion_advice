-- M1c-1: wardrobe items. Owner-only. Tag values mirror src/lib/taxonomy.ts
-- (src/lib/taxonomySql.test.ts fails if the two drift apart).
-- The embedding column is added in a later migration once the AI provider (and so the vector size) is decided.

create table public.clothing_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Paths inside the private item-photos bucket: {owner_id}/{id}/clean.webp and thumb.webp. Set by the server.
  image_path text,
  thumb_path text,
  -- Tags: nullable until AI suggests them and the user confirms.
  category text check (category in ('top', 'bottom', 'one_piece', 'outerwear', 'footwear', 'accessory')),
  subcategory text check (
    subcategory is null or (category is not null and (category || ':' || subcategory) = any (array[
      'top:t_shirt', 'top:shirt', 'top:blouse', 'top:polo', 'top:knit', 'top:sweatshirt', 'top:hoodie',
      'top:tank_top', 'top:cardigan', 'bottom:jeans', 'bottom:trousers', 'bottom:chinos', 'bottom:shorts',
      'bottom:skirt', 'bottom:joggers', 'bottom:leggings', 'one_piece:dress', 'one_piece:jumpsuit',
      'outerwear:coat', 'outerwear:jacket', 'outerwear:blazer', 'outerwear:parka', 'outerwear:gilet',
      'outerwear:raincoat', 'outerwear:overshirt', 'footwear:sneakers', 'footwear:boots',
      'footwear:loafers', 'footwear:derbies', 'footwear:heels', 'footwear:flats', 'footwear:sandals',
      'accessory:bag', 'accessory:belt', 'accessory:scarf', 'accessory:hat', 'accessory:cap',
      'accessory:sunglasses', 'accessory:jewellery', 'accessory:watch', 'accessory:tie',
      'accessory:gloves'
    ]::text[]))
  ),
  colours text[] not null default '{}' check (
    cardinality(colours) <= 4 and array_position(colours, null) is null and colours <@ array[
      'black', 'white', 'off_white', 'grey', 'charcoal', 'silver', 'gold', 'navy', 'beige', 'camel',
      'brown', 'olive', 'denim_blue', 'red', 'burgundy', 'pink', 'orange', 'rust', 'yellow', 'mustard',
      'green', 'forest_green', 'mint', 'teal', 'light_blue', 'blue', 'purple', 'lavender'
    ]::text[]
  ),
  pattern text check (pattern in (
    'solid', 'stripe', 'check', 'herringbone', 'houndstooth', 'floral', 'polka_dot', 'paisley',
    'camouflage', 'animal', 'graphic', 'logo', 'abstract', 'colour_block', 'knit_texture'
  )),
  materials text[] not null default '{}' check (
    cardinality(materials) <= 4 and array_position(materials, null) is null and materials <@ array[
      'cotton', 'linen', 'wool', 'cashmere', 'merino', 'denim', 'leather', 'suede', 'silk', 'polyester',
      'nylon', 'viscose', 'fleece', 'down', 'corduroy', 'tweed', 'jersey', 'canvas', 'synthetic_blend'
    ]::text[]
  ),
  fit text check (fit in ('slim', 'regular', 'relaxed', 'oversized', 'cropped', 'tailored')),
  formality smallint check (formality between 1 and 5),
  seasons text[] not null default '{}' check (
    array_position(seasons, null) is null and seasons <@ array['spring', 'summer', 'autumn', 'winter']::text[]
  ),
  occasions text[] not null default '{}' check (
    array_position(occasions, null) is null and occasions <@ array[
      'everyday', 'work', 'evening', 'party', 'wedding', 'sport', 'outdoor', 'travel', 'lounge'
    ]::text[]
  ),
  brand text check (char_length(brand) <= 80),
  size text check (char_length(size) <= 20),
  notes text check (char_length(notes) <= 500),
  status text not null default 'owned' check (status in ('owned', 'for_sale', 'sold', 'archived')),
  -- What the AI suggested, with confidences, so we can measure how often users correct it. Server-written.
  tag_confidence jsonb,
  tags_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clothing_items is 'Wardrobe items. Owner-only via RLS. Deleted with the auth user.';

create index clothing_items_owner_created_idx on public.clothing_items (owner_id, created_at desc);

alter table public.clothing_items enable row level security;

create policy "clothing_items: owner can read"
  on public.clothing_items for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "clothing_items: owner can insert"
  on public.clothing_items for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "clothing_items: owner can update"
  on public.clothing_items for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "clothing_items: owner can delete"
  on public.clothing_items for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Column-level grants: photo paths, AI confidences and the marketplace statuses are server-managed.
revoke all on public.clothing_items from anon;
revoke all on public.clothing_items from authenticated;
grant select, delete on public.clothing_items to authenticated;
grant insert (category, subcategory, colours, pattern, materials, fit, formality, seasons, occasions,
              brand, size, notes, tags_confirmed_at)
  on public.clothing_items to authenticated;
grant update (category, subcategory, colours, pattern, materials, fit, formality, seasons, occasions,
              brand, size, notes, tags_confirmed_at)
  on public.clothing_items to authenticated;

create trigger clothing_items_set_updated_at
  before update on public.clothing_items
  for each row execute function public.set_updated_at();
