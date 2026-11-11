# Channel3: how we use it

_Owner: Market agent. Last checked against Channel3 docs + official `channel3-ai/skills` reference (SDK 4.x): 2026-11-10._

Channel3 is a product catalogue API covering many brands and shops. We use it for the **"buy new"** (and sometimes
**"buy used"**) tier of outfit recreation (M6), and later for wardrobe-gap suggestions. No scraping, ever.

## Basics
- Base URL `https://api.trychannel3.com`, auth header `x-api-key`. Key lives only in the Supabase Edge Function
  secret `CHANNEL3_API_KEY`. The app never calls Channel3 directly.
- SDK: `@channel3/sdk` 4.x (`import { Channel3 } from '@channel3/sdk'`, requests use snake_case fields).
  In Deno Edge Functions import via `npm:@channel3/sdk@4`. Plain `fetch` is fine too.
- Locale: we always send `config: { country: 'SE', currency: 'SEK', language: 'sv' }` (fallback `country: 'EU', currency: 'EUR'`
  if Swedish results are thin). Locale decides which shops' offers come back.

## Endpoints we use

| Need | Endpoint | Cost | Where |
|---|---|---|---|
| Find items like a garment (text, image, or both) | `POST /v1/search` | 1 credit | M6 recreate, wardrobe gaps |
| "More like this" from a Channel3 product | `POST /v1/similar` | 1 credit | product detail screen |
| Fresh price, stock, buy link before showing | `GET /v1/products/{id}` | **free** | every time we display a product |
| Category slugs for filters | `GET /v1/categories/search` | assume 1 credit | one-off, cached forever |
| Brand IDs | `GET /v1/brands/search` | assume 1 credit | rare, cached |
| Click/sale reporting | `GET /v1/reporting/*` | assume 1 credit | weekly heartbeat cost report |

Not planned: `lookup` (slow, for pasted URLs only), `browse` (access-restricted), `conversations` (we have our own stylist),
`keyword` mode (no image support). `agentic` mode is a maybe for open questions ("what do I wear to a wedding?"); it costs
seconds of latency, so only behind an explicit user action.

### Useful search features for us
- **Image search:** `image_url` (or `base64_image`) plus optional `query`. For M6 we crop each detected garment from the
  inspiration photo, upload the crop to Storage, and pass a signed URL. Text query = our own tags ("navy wool overcoat").
- **Filters instead of query-stuffing:** `price.max_price`, `gender`, `category_ids` (slugs), `colors.palette` (hex, from
  our colour tags), `attributes` (e.g. `material`), `sale: 'on_sale'`.
- **Used offers:** `conditions: ['used']` returns second-hand offers from shops. **Approved (2026-11-11)** as the middle tier:
  searched after the in-app marketplace and before new items. Labelled "buy used" in the UI, same as marketplace items.
- **Default filters:** `availability` defaults to in stock and `conditions` to new. Keep those defaults unless we ask for used.
- `limit` max 30; we use 6–10 per garment.

## Caching rules (important)
Channel3 says: **cache IDs, not data**. Prices, stock and offer URLs change, and offer URLs are short-lived affiliate links.
Proposed `external_products` rules (they change the "cache results" line in AGENTS.md, so they **need owner OK** first, see below):

| Data | Cache? | TTL |
|---|---|---|
| `external_id` (Channel3 product id), category slugs, brand ids | yes | forever |
| title, brand, main image (`cleaned_url` preferred), category, colours, materials, embedding | yes | 7 days |
| price, currency, availability, best offer domain | yes, for ranking only | 24 h |
| offer `url` (buy link) | **never stored** | fetched fresh with free `GET /v1/products/{id}` when the user opens the item |
| search results (query hash → ordered list of `external_id`) | yes | 24 h |

Search-result cache key = hash of (normalised query, image hash, filters, locale). Identical garments across users
(e.g. "white sneakers, under 1500 SEK") hit the same cache entry.

## Staying in the free tier
- Free: **1,000 credits/month**, then **$0.007 per call** (≈ $7 per extra 1,000). Each call = 1 credit; product detail and
  product subscriptions are free.
- Budget per feature (until owners approve paid): M6 recreate 600/month (incl. EU-fallback searches), wardrobe gaps 150,
  "more like this" (`/v1/similar`) 150, buffer 100 (category/brand lookups, reporting).
- One recreate request ≈ 3–5 garments ≈ 3–5 searches before cache. Target cache hit rate ≥ 40 % → ~2.5 credits per request
  → ~240 recreates/month on the free tier.
- Guards in the Edge Function:
  - per-user limit: 5 recreates/day, 30/month (configurable)
  - global monthly counter from `api_usage` (provider `channel3`, units = credits); when 90 % used, stop calling Channel3 and show
    owned + marketplace results only, with a "shop results paused" note
  - dedupe garments in one request; only search garments the user didn't match well in their own wardrobe
    (owned match score below threshold). That's the biggest saving and fits "owned first".
- Every call is logged to `api_usage` and reported in the heartbeat (calls, cache hit rate, projected month-end usage).

## Ranking and labelling
- Order in the recreated outfit: **owned → marketplace (used) → Channel3 used → Channel3 new**.
- Only offers that ship to Sweden are shown (locale `SE`; with the `EU` fallback we keep only offers whose shop ships to SE).
- Within those, rank by visual + attribute fit (Fashion agent's score), then price fit.
  `max_commission_rate` is used **only as a tie-breaker** when fit scores are equal. Never above a better match.
- Every shop link is labelled "Shop link · we may earn a commission" in the UI. Link opens the retailer in the browser.

## Money
- Each `ProductOffer.url` is affiliate-tracked automatically. Channel3 keeps a share of commissions (docs: initially 50 %,
  falling with volume).
- Pass our user id as `x-user-id` (the Supabase user UUID, nothing personal) to get per-user click/sale attribution in
  `/v1/reporting`. Lets us report revenue per active user vs Channel3 cost.
- Break-even rough guess: at $7 per 1,000 extra searches and a 50 % share of a ~5 % commission, one ~1,000 SEK sale per
  ~300 paid searches covers cost. Track real numbers before deciding on a paid plan.

## Privacy
- Inspiration-photo crops sent to Channel3 must contain only the garment (crop tightly, blur or exclude faces).
  Store crops in a private bucket and use short-lived signed URLs (≤ 10 min).
- `x-user-id` is the opaque UUID, never email/name. Mention Channel3 as a processor in the privacy policy.

## Open questions for owners
1. Approve the caching change above (store IDs + display fields; buy links fetched fresh). Needs a line in AGENTS.md.
2. Free-tier guard numbers (5/day, 30/month per user) fine for testing?
