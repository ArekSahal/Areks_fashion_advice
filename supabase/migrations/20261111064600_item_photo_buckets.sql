-- M1c-1: private photo buckets (docs/architecture.md → Storage).
-- uploads-quarantine: the app uploads here; clients can write their own folder but never read it.
--   The process-image Edge Function strips EXIF/GPS, blurs faces (unless consented), re-encodes to WebP,
--   writes to item-photos with the service role and deletes the quarantine copy.
-- item-photos: only metadata-free files. Owner can read and delete; only the server writes.
-- Paths always start with {user_id}/ so account-export/account-delete find every file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('uploads-quarantine', 'uploads-quarantine', false, 15728640,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('item-photos', 'item-photos', false, 5242880, array['image/webp'])
on conflict (id) do nothing;

create policy "uploads-quarantine: owner can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads-quarantine' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "item-photos: owner can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "item-photos: owner can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
