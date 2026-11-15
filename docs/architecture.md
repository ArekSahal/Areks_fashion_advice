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
   ├─ Storage ......... item photos, outfit photos, inspiration photos (private buckets)
   └─ Edge Functions .. everything that needs a secret or costs money
         ├─ tag-item ............ vision LLM → suggested tags
         ├─ process-image ....... EXIF strip, background removal, thumbnail
         ├─ cleanup-quarantine .. hourly (pg_cron): removes quarantine uploads older than 1 h
         ├─ embed ............... image + text embeddings → pgvector
         ├─ recommend ........... "what goes with this?" (rules + embeddings)
         ├─ style-profile ....... style analysis (M5)
         ├─ recreate-outfit ..... garment detection + matching (M6)
         ├─ channel3-search ..... Channel3 search with cache + budget guard
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
| `clothing_items` | id, owner_id, image_path, thumb_path, category, subcategory, colours[], pattern, materials[], fit, formality, seasons[], occasions[], brand, size, status (owned/for_sale/sold/archived), tag_confidence jsonb, embedding vector, created_at | owner only; marketplace reads go through `listings` |
| `outfits` | id, owner_id, worn_on date, photo_path, notes | owner only |
| `outfit_items` | outfit_id, item_id | owner only (via outfit); wear counts and "last worn" come from here (view `item_wear_stats`) |
| `listings` | id, item_id, seller_id, price, currency, condition, size, city, status (active/reserved/sold/withdrawn) | **signed-in users** read active listings through `listings_public` (a view with `security_invoker = true`, safe columns only, no exact location); seller writes. Never a plain view (views bypass RLS by default) |
| `conversations` / `messages` | buyer, seller, listing; sender, body, created_at | only the two participants |
| `style_profiles` | owner_id, computed_at, summary jsonb | owner only |
| `inspiration_requests` | id, owner_id, image_path, status, result jsonb | owner only |
| `external_products` | source ('channel3'), external_id, title, brand, image_url, category, colours[], materials[], embedding, price_hint, currency, availability_hint, best_offer_domain, fetched_at | readable by authenticated users; written only by Edge Functions. **No buy URLs stored**: fetched fresh with the free product-detail call (see `docs/DECISIONS.md` and `docs/channel3.md`) |
| `external_search_cache` | key_hash, external_ids[], fetched_at | Edge Functions only |
| `recommendation_feedback` | owner_id, seed_item_id, candidate ref, signal (shown/accepted/liked/disliked/worn), created_at | owner only |
| `api_usage` (built in M1c) | feature, provider (vertex / channel3 / photoroom), units + unit (tokens / credits / calls), cost_estimate_usd, user_id (nullable), ok, created_at; Vertex rows also keep model, location, input/output tokens | Edge Functions write (one row per paid call, also failed ones); owner can read own rows (included in export); owners read totals via dashboard. On account delete: `user_id` set to null (aggregate cost kept). Vertex cost formula in `src/lib/vertex.ts` |
| `events` | user_id, name, props jsonb, created_at | insert-own-only; deleted with the account. See `docs/metrics.md` |

Conventions: `uuid` primary keys, `owner_id` → `auth.users(id) on delete cascade`, `created_at`/`updated_at` timestamps,
enums as `text` + check constraints mirroring `src/lib/taxonomy.ts`.

## Storage
| Bucket | Path | Access |
|---|---|---|
| `item-photos` | `{user_id}/{item_id}/{clean|thumb}.webp` (`.jpg` for photos from Safari) | private; owner via RLS on `storage.objects` |
| `outfit-photos` | `{user_id}/{outfit_id}.webp` | private |
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
`process-image` detects faces and blurs them unless `profiles.consent_face_analysis` is true. Mirror selfies of outfits
are the common case, so this is the default path, not an edge case.

## Key flows
**Add item (M1, target < 30 s):** camera → client resize/re-encode → upload to `uploads-quarantine` → `process-image`
(strip, blur faces, move to `item-photos`) → insert `clothing_items`
(status `owned`, tags empty) → call `tag-item` → user confirms chips → save → `process-image` + `embed` run in background.

**Post outfit (M2):** photo (optional) + pick items → insert `outfits` + `outfit_items` → wear stats update via view.

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
