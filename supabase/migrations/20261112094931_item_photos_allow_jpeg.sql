-- M1c-2: Safari can't encode WebP in a canvas, so the web app re-encodes photos to JPEG there.
-- process-image strips metadata from both formats and stores clean.jpg / thumb.jpg for those uploads.
update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg']
where id = 'item-photos';
