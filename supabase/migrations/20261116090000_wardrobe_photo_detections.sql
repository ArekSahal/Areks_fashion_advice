-- #36 slice 3: detect-garments stores its result on the photo, so process-image can create each confirmed item from
-- the stored garment (box + suggested tags) instead of trusting values the app sends. Server-written only: neither
-- column is in the client grants of 20261115123000_wardrobe_photos.sql. Owners can read them (select on the table).
alter table public.wardrobe_photos
  add column detections jsonb check (detections is null or jsonb_typeof(detections) = 'object'),
  add column detected_at timestamptz;
