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
| `listings` | id, item_id, seller_id, price, currency, condition, size, city, status (active/reserved/sold/withdrawn) | public read when active (via a view with only safe columns); seller writes |
| `conversations` / `messages` | buyer, seller, listing; sender, body, created_at | only the two participants |
| `style_profiles` | owner_id, computed_at, summary jsonb | owner only |
| `inspiration_requests` | id, owner_id, image_path, status, result jsonb | owner only |
| `external_products` | source ('channel3'), external_id, title, brand, image_url, category, colours[], embedding, price_hint, currency, availability_hint, fetched_at | readable by authenticated users; written only by Edge Functions. **No buy URLs stored** (see `docs/channel3.md`) |
| `external_search_cache` | key_hash, external_ids[], fetched_at | Edge Functions only |
| `recommendation_feedback` | owner_id, seed_item_id, candidate ref, signal (shown/accepted/liked/disliked/worn), created_at | owner only |
| `api_usage` | feature, provider, units, cost_estimate, user_id, created_at | Edge Functions write; owners read via dashboard |

Conventions: `uuid` primary keys, `owner_id` → `auth.users(id) on delete cascade`, `created_at`/`updated_at` timestamps,
enums as `text` + check constraints mirroring `src/lib/taxonomy.ts`.

## Storage
| Bucket | Path | Access |
|---|---|---|
| `item-photos` | `{user_id}/{item_id}/{original|clean|thumb}.webp` | private; owner via RLS on `storage.objects` |
| `outfit-photos` | `{user_id}/{outfit_id}.webp` | private |
| `inspiration` | `{user_id}/{request_id}/…` | private; crops shared with Channel3 only via ≤ 10-min signed URLs |
| `listing-photos` | `{listing_id}/…` | public read while listing active (copies, not the private originals) |

EXIF (incl. GPS) is stripped **on the device before upload** where possible, and again in `process-image`.
Images are resized to max 1600 px and stored as WebP.

## Key flows
**Add item (M1, target < 30 s):** camera → client resize + EXIF strip → upload to `item-photos` → insert `clothing_items`
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
| Production DB | Supabase project `emnkjfoccluygilkebbz` | **the only remote DB, also used by previews** |

⚠️ **Risk:** previews and production share one database. Fine while we're the only users; before real users arrive we
need a separate dev project (free tier allows 2 projects) or Supabase branching (paid). Decision needed before M1 ends.

## Security and privacy checklist (enforced in review)
- RLS enabled on every table (CI checks migrations) and Supabase security advisors clean after each migration.
- Only the publishable key in the app; secret keys only in Edge Function secrets.
- No faces analysed unless the user opts in; inspiration crops exclude faces.
- GDPR: `account-export` (JSON + photos zip) and `account-delete` (cascade + storage cleanup) ship in M1, not later.
- Consent flags stored on `profiles` with timestamp.

## Open questions for owners
1. Separate dev Supabase project now (free) or when the first outside testers join?
2. Vision/embedding provider: start with one hosted API (simplest) and revisit cost in M3? Platform + Fashion will propose
   2 options with prices at the start of M1.
