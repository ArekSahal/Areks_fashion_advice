# Architecture

_Owner: Platform agent. v1, 2026-11-10. Updated whenever a milestone changes the system._

## Overview

```
 Expo app (iOS / Android / web on GitHub Pages)
   │  supabase-js (publishable key + user JWT; RLS decides what each user sees)
   ▼
 Supabase (eu-north-1, Stockholm)
   ├─ Auth ............ email + Google/Apple
   ├─ Postgres ........ all app data, RLS on every table, pgvector for embeddings
   ├─ Storage ......... item + wardrobe/outfit photos, inspiration photos (private buckets)
   └─ Edge Functions .. everything that needs a secret or costs money
         ├─ tag-item ............ vision LLM → suggested tags
         ├─ detect-garments ..... vision LLM → every garment in a wardrobe photo (box + tags), #36
         ├─ process-image ....... EXIF strip, background removal, thumbnail
         ├─ cleanup-quarantine .. hourly (pg_cron): removes quarantine uploads older than 1 h
         ├─ embed ............... image + text embeddings → pgvector
         ├─ recommend ........... "what goes with this?" (rules + embeddings)
         ├─ style-profile ....... style analysis (M5)
         ├─ recreate-outfit ..... garment detection + matching (M6)
         ├─ channel3-search ..... Channel3 Shop search (24 h ID cache) + fresh buy links; opt-in EU locale fallback (allow_eu) for thin SE results
         └─ account-export / account-delete (GDPR)
   ▼
 External: vision LLM / embedding provider (TBD in M1), Channel3 API
```

**Rule of thumb:** the app reads and writes its own rows directly through supabase-js (RLS protects them). Anything that
uses a secret key, costs money per call, or touches other users' data goes through an Edge Function.

## Data model (target for M1–M6)
Tables are created milestone by milestone as migrations in `supabase/migrations/`; this is the target shape.

| Table | Key columns | Notes / RLS |
|---|---|---|
| `profiles` | id (= auth.users.id), display_name, locale, style_unlocked_at, consent_* flags | owner only; created by trigger on sign-up |
| `clothing_items` | id, owner_id, image_path, thumb_path, category, subcategory, colours[], pattern, materials[], fit, formality, seasons[], occasions[], brand, size, status (owned/for_sale/sold/archived), tag_confidence jsonb, tags_confirmed_at, source_photo_id, source_box jsonb (server-set), embedding vector, created_at | owner only; marketplace reads go through `listings`. **The tag columns hold unconfirmed AI suggestions until `tags_confirmed_at` is set** (the original suggestion stays in `tag_confidence.suggested`). Every consumer (recommend, outfits, style profile, listings, search) must filter `tags_confirmed_at is not null` or treat the tags as suggestions |
| `wardrobe_photos` | id, owner_id, image_path, thumb_path, faces_blurred_at, taken_at, detections jsonb, detected_at, created_at | owner only. The original photo items were cut from (Wardrobe → Outfits, #36). Paths, `faces_blurred_at` and `detections` are server-set. A photo is not a "worn" entry by itself (wear counts stay honest); a diary entry can point at one as its outfit photo |
| `outfits` (built in M2, #56) | id, owner_id, worn_on date (user's local day, ≤ today + 1), photo_id → `wardrobe_photos` (nullable), occasion (nullable, taxonomy `OCCASIONS`), notes (≤ 500), created_at, updated_at | owner only. Outfit diary: **several entries per day allowed** (an outfit change is a second entry; indexed on `(owner_id, worn_on)`, not unique). The photo reuses `wardrobe_photos` (no separate outfit-photo table or bucket); deleting the photo only clears `photo_id`. Clients write `worn_on`, `photo_id`, `occasion`, `notes` |
| `outfit_items` (built in M2, #56) | outfit_id, item_id, owner_id, created_at | owner only. Entry and item must have the same owner: composite foreign keys `(outfit_id, owner_id)` → `outfits` and `(item_id, owner_id)` → `clothing_items`, so it holds for every role and never reveals other users' ids. Deleting the entry or the item removes the link. No client update (delete + insert) |
| `item_wear_stats` (view, M2) | item_id, owner_id, wear_count, last_worn_on | `security_invoker = true`, signed-in select only. One row per item of the caller (0 / null if never worn). `wear_count` = number of **distinct days** worn (two entries on one day count once). Derived from `outfits` + `outfit_items`, never stored. Lists every item regardless of `status` / `tags_confirmed_at`: consumers filter (see `docs/styling-engine.md` §4) |
| `listings` | id, item_id, seller_id, price, currency, condition, size, city, status (active/reserved/sold/withdrawn) | **signed-in users** read active listings through `listings_public` (a view with `security_invoker = true`, safe columns only, no exact location); seller writes. Never a plain view (views bypass RLS by default) |
| `conversations` / `messages` | buyer, seller, listing; sender, body, created_at | only the two participants |
| `style_profiles` | owner_id, computed_at, summary jsonb | owner only |
| `inspiration_requests` | id, owner_id, image_path, status, result jsonb | owner only |
| `external_products` (built in M1.5) | external_id, title, brand, image_url, category_slug, gender, materials[], price, currency, condition, offer_domain, refreshed_at (embedding comes with M3/M6) | Edge Functions only (RLS on, no policies, no client grants); the app gets products from `channel3-search`. Display fields kept 7 days, price/condition 24 h for ranking. **No buy URLs stored**: fetched fresh (see `docs/DECISIONS.md` and `docs/channel3.md`) |
| `channel3_search_cache` (built in M1.5) | cache_key (sha256 of normalised query + filters + locale), product_ids[], created_at | Edge Functions only. Reused for 24 h; daily pg_cron job deletes old rows. The EU fallback's id list is a separate row (EU locale in the key); the SE row is unchanged |
| `recommendation_feedback` | owner_id, seed_item_id, candidate ref, signal (shown/accepted/liked/disliked/worn), created_at | owner only |
| `api_usage` (built in M1c) | feature, provider (vertex / channel3 / photoroom), units + unit (tokens / credits / calls), cost_estimate_usd, user_id (nullable), ok, created_at; Vertex rows also keep model, location, input/output tokens | Edge Functions write (one row per paid call, also failed ones); owner can read own rows (included in export); owners read totals via dashboard. On account delete: `user_id` set to null (aggregate cost kept). Vertex cost formula in `src/lib/vertex.ts` |
| `events` | user_id, name, props jsonb, created_at | insert-own-only; deleted with the account. See `docs/metrics.md` |

Conventions: `uuid` primary keys, `owner_id` → `auth.users(id) on delete cascade`, `created_at`/`updated_at` timestamps,
enums as `text` + check constraints mirroring `src/lib/taxonomy.ts`.

## Storage
| Bucket | Path | Access |
|---|---|---|
| `item-photos` | `{user_id}/{item_id}/{clean|thumb}.webp` (`.jpg` for photos from Safari) | private; owner via RLS on `storage.objects` |
| `inspiration` | `{user_id}/{request_id}/…` | private; crops shared with Channel3 only via ≤ 10-min signed URLs |
| `listing-photos` | `{user_id}/{listing_id}/…` | signed-in read while listing active (copies, not the private originals) |
| `uploads-quarantine` | `{user_id}/{upload_id}` | write-own only, **no client read**; Edge Function strips EXIF + moves the file, then deletes it |

**EXIF (incl. GPS):** photos are re-encoded on the device before upload (drops EXIF), and every upload lands in
`uploads-quarantine` first. The app resizes (max 1600 px, plus a 400 px thumbnail) and encodes WebP (native:
expo-image-manipulator; web: canvas). Safari can't encode WebP in a canvas, so the web app sends JPEG there.
The app uploads `{user_id}/{upload_id}.{webp|jpg}` and `{user_id}/{upload_id}.thumb.{webp|jpg}` and calls `process-image`
with `{ upload_id, format }`. The function builds the paths from the caller's id (never from client paths), sniffs the
format from the bytes, rejects anything that isn't a still WebP/JPEG within the size limits (≤ 5 MB / 2048 px clean,
≤ 512 KB / 640 px thumb), strips metadata again (`supabase/functions/_shared/sanitize-image.ts`: allowlist of image
chunks/markers, tested in `src/lib/sanitizeImage.test.ts`), optionally removes the background (only if the
`PHOTOROOM_API_KEY` secret exists, the user turned on "Let AI see faces" since faces aren't blurred yet, and they are
under 50 calls/24 h; each call is logged in `api_usage` first and skipped if it can't be logged), writes `item-photos/{user_id}/{item_id}/clean.*` + `thumb.*`, inserts the
`clothing_items` row and deletes the quarantine copies (also when processing fails). No file with metadata is ever
readable by clients or kept. Leftovers (the app uploaded but never called `process-image`) are removed by
`cleanup-quarantine`: a pg_cron job (`cleanup-quarantine`, minute 17 of every hour) calls it through pg_net with a
shared secret from Vault, and it deletes every quarantine file older than 1 hour through the Storage API
(selection logic in `supabase/functions/_shared/quarantine-cleanup.ts`, tested in `src/lib/quarantineCleanup.test.ts`).
Each run returns and logs `{ removed, scanned, kept }`; history in `cron.job_run_details` and `net._http_response`.

**Faces:** before any photo goes to an AI provider (tagging, outfit analysis, style analysis, garment detection),
faces must be blurred unless `profiles.consent_face_analysis` is true. Mirror selfies of outfits are the common case, so
this is the default path, not an edge case. Faces are blurred on the device before upload
(`docs/ai-providers.md` §4), so no unblurred photo leaves the device for detection:
- **Web:** MediaPipe face detector (BlazeFace short-range, `@mediapipe/tasks-vision`, pinned exactly) in the browser,
  prefetched when the Add tab opens. All files are self-hosted on the app's origin: `scripts/vendor-mediapipe.mjs` copies
  the library and WebAssembly runtime from `node_modules` into `public/mediapipe/` before every web export, and downloads
  the model from Google's `storage.googleapis.com/mediapipe-models` bucket at build time, checked against a pinned SHA-256.
  The browser loads nothing from third-party hosts. It scans the whole photo plus overlapping tiles (small faces in
  full-body selfies), and every padded face box is blurred on the canvas before encoding (at most 4 cells across the
  face); the thumbnail is made from the blurred photo. Logic in `src/lib/faceBlur.ts`.
- **Native:** not yet (ML Kit needs a development build); native uploads report `skipped`.
- The app sends `face_check: 'blurred' | 'none' | 'skipped'` to `process-image`, which trusts this device report (no
  server-side check, see [`DECISIONS.md`](DECISIONS.md)). Only `blurred` or `none` (detector ran, no face) sets
  `clothing_items.faces_blurred_at = now()` (service role); anything else, including a detector that failed to load,
  leaves it unset (fail closed), and without consent `tag-item` then does not send the photo to the AI. Clients can't
  write `faces_blurred_at` (column grants, tested in `src/lib/faceCheck.test.ts`). A modified client can only
  misreport its own uploads.

## Key flows
**Add item (M1, target < 30 s):** camera → client resize/re-encode → upload to `uploads-quarantine` → `process-image`
(strip, blur faces, move to `item-photos`) → insert `clothing_items`
(status `owned`, tags empty) → call `tag-item` (writes the suggestion into the tag columns + `tag_confidence`, still
unconfirmed) → **Confirm tags** screen (`app/confirm-tags.tsx`): user checks/fixes the chips → Save writes the tags and
`tags_confirmed_at` → `embed` runs in background. "Skip for now" leaves `tags_confirmed_at` null; the wardrobe shows the
item as "Needs tags" and never displays its unconfirmed tags as facts.

**Detect garments in a wardrobe photo (#36, slice 2 built; Add flow in slice 3):** `detect-garments` takes
`{ photo_id }` (a `wardrobe_photos` row the caller owns, read through RLS; its `image_path` must be the server-set
`{user_id}/photos/{photo_id}/…`), applies the same face rule as `tag-item` (`faces_blurred_at` or
`consent_face_analysis`), caps each user at 30 calls / 24 h and the photo at the `process-image` size limit, logs every Vertex call in `api_usage` (feature
`detect_garments`) and returns up to 8 garments, most prominent first (layered pieces such as a shirt under a knit stay separate; the two
shoes of a pair are merged into one box): `box` in the `source_box` format
(`{x, y, w, h}` fractions), `tags`, `confidence`, `needs_check`, `detection_confidence` and `uncertain` (leave unticked).
It stores the garments (same order as the reply) on `wardrobe_photos.detections` and writes no items. A repeat call
answers from the stored result (`status: 'already_detected'`, no Vertex call) unless the app sends `force: true`, so
garment indexes can't shift under a confirm screen that is still open. Prompt, schema, parser and the box → pixel crop helper are in `src/lib/detection.ts`, which reuses the
per-garment parser and schema from `src/lib/tagging.ts`.

**Save garments from a wardrobe photo (#36 slice 3, server side):** the app uploads the original photo through
`process-image` with `target: 'wardrobe_photo'` (stored under `{user_id}/photos/{photo_id}/`, no background removal,
same face-check rule) → `detect-garments` → the user ticks garments → for each, the app crops it on the device (box →
pixels with `boxToCropRect`), blurs faces, and uploads it as a normal item with `source: { photo_id, garment_index }`.
`process-image` looks the garment up in the caller's stored `detections` and sets `source_photo_id`, `source_box` and
the suggested tags (`tag_confidence.source = 'detect_garments'`, still unconfirmed), so the box and tags never come
from the request. The same garment can't be saved twice (409 `garment_already_saved`). Helpers: `src/lib/garmentSource.ts`. The item then goes through **Confirm tags** like any other.

**Post outfit (M2, #56; data model built in slice 1):** pick items (and optionally a photo, uploaded through the usual
`process-image` path as a `wardrobe_photos` row) → insert a new `outfits` row (`worn_on` = the device's local date; never
an upsert of the day: posting again the same day adds a second entry, e.g. an outfit change; editing goes through the
entry's id). The app reads the new id back with supabase-js `.insert(…).select('id')` (clients can't set `id`) → insert `outfit_items` (the app sends only `outfit_id` + `item_id`;
`owner_id` defaults to `auth.uid()` and the foreign keys reject someone else's item or photo) → wear count and
"last worn" come from `item_wear_stats` (a day counts once), nothing to update. Items cut from a wardrobe photo are not "worn" until a
diary entry links them.

**What goes with this (M3):** `recommend(item_id)` → candidates from the user's items (+ active listings later) →
rule score + embedding similarity → top 10 with reasons → log `shown` in `recommendation_feedback`.

**Recreate outfit (M6):** upload photo → `recreate-outfit` detects garments → per garment: owned → marketplace →
`channel3-search` (only if needed) → result saved on `inspiration_requests`.

## Environments
| Env | What | Status |
|---|---|---|
| Local | `supabase start` (Docker) + `npm run web` | config in `supabase/config.toml` |
| Preview | GitHub Pages build of any branch (one at a time) | live |
| Production DB | Supabase project `emnkjfoccluygilkebbz` | the only remote DB, **shared by previews and the live app** |

**Owner decision (2026-11-11): previews and live share one database.** Consequences agents must respect:
- Migrations are additive and backwards-compatible (add columns/tables; rename or drop only in a later migration once
  `main` no longer uses the old shape), because an older preview or the live build may still be running.
- Test data created from previews is real data: use test accounts, and clean up what you create.
- Destructive SQL (drop, truncate, mass delete/update) needs an owner `/approve` first, same as other irreversible actions.

## Security and privacy checklist (enforced in review)
- RLS enabled on every table (CI checks migrations) and Supabase security advisors clean after each migration.
- Only the publishable key in the app; secret keys only in Edge Function secrets.
- No faces sent to AI unless the user opts in (blurred by default, see Storage); inspiration crops exclude faces.
- GDPR: `account-export` (JSON + photos zip) and `account-delete` ship in M1, not later. Delete rules per table:
  own rows cascade from `auth.users`; all storage under `{user_id}/` in every bucket is removed;
  `api_usage.user_id` is nulled; `events` deleted; messages the user sent to others are replaced with "deleted user" and their body cleared;
  active listings are withdrawn first.
- Consent flags stored on `profiles` with timestamp.

## Open questions for owners
1. Vision/embedding provider: start with one hosted API (simplest) and revisit cost in M3? Platform + Fashion will propose
   2 options with prices at the start of M1.
