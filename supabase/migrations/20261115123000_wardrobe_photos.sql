-- #36 slice 1: original photos in the wardrobe ("Outfits" view) and the link from each item to the photo it was
-- cut from. Kept separate from the M2 diary (outfits / outfit_items): a wardrobe photo is a source of items, not a
-- "worn on this day" entry, so reusing diary rows would inflate wear counts (Platform, 2026-11-14 heartbeat).
-- A later diary entry can point at a wardrobe photo instead of storing the image twice.

create table public.wardrobe_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Paths inside the private item-photos bucket: {owner_id}/photos/{id}/clean.webp and thumb.webp. Set by the server
  -- (process-image), only after EXIF is stripped and faces are blurred unless the user consented.
  image_path text,
  thumb_path text,
  -- Same meaning as clothing_items.faces_blurred_at: set by the server; AI calls on this photo need it or consent.
  faces_blurred_at timestamptz,
  -- When the photo was taken, if the user tells us (EXIF is stripped, so the server never reads it from the file).
  taken_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.wardrobe_photos is
  'Original wardrobe photos (outfits) that items are cut from. Owner-only via RLS. Deleted with the auth user.';

create index wardrobe_photos_owner_created_idx on public.wardrobe_photos (owner_id, created_at desc);

alter table public.wardrobe_photos enable row level security;

create policy "wardrobe_photos: owner can read"
  on public.wardrobe_photos for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "wardrobe_photos: owner can insert"
  on public.wardrobe_photos for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "wardrobe_photos: owner can update"
  on public.wardrobe_photos for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "wardrobe_photos: owner can delete"
  on public.wardrobe_photos for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Column-level grants: paths and faces_blurred_at are server-managed.
revoke all on public.wardrobe_photos from anon;
revoke all on public.wardrobe_photos from authenticated;
grant select, delete on public.wardrobe_photos to authenticated;
grant insert (taken_at) on public.wardrobe_photos to authenticated;
grant update (taken_at) on public.wardrobe_photos to authenticated;

create trigger wardrobe_photos_set_updated_at
  before update on public.wardrobe_photos
  for each row execute function public.set_updated_at();

-- Items cut from a wardrobe photo. Both columns are written by the server when it saves a detected garment
-- (not in the client grants), so a client can't link its item to someone else's photo.
-- source_box: where the garment is in the original photo, as fractions of width/height:
-- {"x": 0.12, "y": 0.30, "w": 0.40, "h": 0.55}.
alter table public.clothing_items
  add column source_photo_id uuid references public.wardrobe_photos (id) on delete set null,
  add column source_box jsonb check (
    source_box is null or (
      jsonb_typeof(source_box) = 'object'
      and (source_box ->> 'x')::numeric between 0 and 1
      and (source_box ->> 'y')::numeric between 0 and 1
      and (source_box ->> 'w')::numeric > 0 and (source_box ->> 'w')::numeric <= 1
      and (source_box ->> 'h')::numeric > 0 and (source_box ->> 'h')::numeric <= 1
      and (source_box ->> 'x')::numeric + (source_box ->> 'w')::numeric <= 1.0001
      and (source_box ->> 'y')::numeric + (source_box ->> 'h')::numeric <= 1.0001
    )
  );

create index clothing_items_source_photo_idx on public.clothing_items (source_photo_id)
  where source_photo_id is not null;
