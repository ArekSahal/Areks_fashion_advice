# Channel3: how we use it

_Owner: Market agent. Last checked against Channel3 docs + official `channel3-ai/skills` reference (SDK 4.x): 2026-11-10._

Channel3 is a product catalogue API covering many brands and shops. We use it for the **"buy new"** (and sometimes
**"buy used"**) tier of outfit recreation (M6), and later for wardrobe-gap suggestions. No scraping, ever.

## Basics
- Base URL `https://api.trychannel3.com`, auth header `x-api-key`. Key lives only in the Supabase Edge Function
  secret `CHANNEL3_API_KEY`. The app never calls Channel3 directly.
- SDK: `@channel3/sdk` 4.x (`import { Channel3 } from '@channel3/sdk'`, requests use snake_case fields).
  In Deno Edge Functions import via `npm:@channel3/sdk@4`. Plain `fetch` is fine too.
- Locale: we always send `config: { country: 'SE', currency: 'SEK', language: 'en' }` (fallback `country: 'EU', currency: 'EUR'`
  if Swedish results are thin). Country and currency decide which shops' offers come back; `language: 'en'` keeps titles
  in English because the app is English-only (see [`DECISIONS.md`](DECISIONS.md)). The product detail call takes the same
  three values as query parameters.

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

## M1.5 Shop search (`channel3-search`, built 2026-11-15)
- Runs only when the user taps **Search** (or opens a card). Changing filters never triggers a call.
- Input: free text (≤ 100 chars) plus picker filters: category (added to the query as a word, since category slugs
  need a paid lookup), gender, max price (500 / 1,000 / 2,000 SEK), second-hand only. Size isn't a Channel3 filter, so it's left out for now.
- **One credit per uncached search:** `conditions: ['new', 'used']` returns both kinds in one call, and the function
  ranks second-hand first (Channel3 order kept within each group). "Second-hand only" sends `['used']`.
- Best offer per product: in stock → used → cheapest → highest commission (tie-breaker only).
- Cache hit (same normalised query + filters within 24 h): the stored id list is refreshed with the free product detail
  call, so prices and buy links are always fresh. If that fails, the card shows from `external_products` without a price.
- Buy links older than 15 minutes are refreshed with the free `offer` action before opening.
- Logging: each paid search writes `api_usage` (provider `channel3`, feature `shop_search`, 1 credit) **before** the call;
  if the log fails, no call is made. Logic and tests: `src/lib/shop.ts`, `src/lib/shop.test.ts`.
- **EU fallback** (built 2026-11-19): if the Swedish search keeps fewer than **4** cards (`EU_FALLBACK_MIN_SE_RESULTS`,
  one phone screen), one more paid search runs with `config: { country: 'EU', currency: 'EUR', language: 'en' }`
  (`EU` is a documented pan-region value, see [Localization](https://channel3.ai/docs/guides/localization)).
  Logged first as model `v1/search:eu`; if that log or the call fails, the Swedish results are returned alone.
  So a thin search costs 2 credits, a normal one 1.
  - Price cap: the SEK cap is sent as EUR at a fixed, deliberately high **12 SEK/EUR** (`SEK_PER_EUR`, rounded down:
    500 / 1,000 / 2,000 kr → €41 / €83 / €166), so an EU item never costs more than the cap the user picked.
  - Results: Swedish cards first, then EU cards not already shown, second-hand first within each, max 12. EU cards
    carry `region: 'EU'` in the response (Swedish cards unchanged) and show "EU shop · price in €".
  - Cache: the EU id list is its own `channel3_search_cache` entry (key includes the EU locale; the Swedish key is
    unchanged, so no schema change). A cache hit refreshes each id in its own locale and never pays for a new fallback.
    The `offer` action takes `region: 'EU'` for EU cards.
  - **Shipping to Sweden is not verified.** Channel3 offers have no shipping-destination field, so we can't filter EU
    shops by delivery to SE. The UI says so under the results ("EU shops may not deliver to Sweden...").

## Caching rules (important)
Channel3 says: **cache IDs, not data**. Prices, stock and offer URLs change, and offer URLs are short-lived affiliate links.
`external_products` rules (decided 2026-11-11, see [`DECISIONS.md`](DECISIONS.md)):

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
- Planning budget per feature (a target, not a hard limit): M6 recreate 600/month (incl. EU-fallback searches), wardrobe gaps 150,
  "more like this" (`/v1/similar`) 150, buffer 100 (category/brand lookups, reporting). Until M6 ships, the M1.5 Shop may use
  up to ~400 of the M6 share (see [`DECISIONS.md`](DECISIONS.md)).
- One recreate request ≈ 3–5 garments ≈ 3–5 searches before cache. Target cache hit rate ≥ 40 % → ~2.5 credits per request
  → ~240 recreates/month on the free tier.
- **No usage limits for now** (see [`DECISIONS.md`](DECISIONS.md), 2026-11-11). No per-user caps and no automatic stop. Calls past the free
  1,000/month are billed at $0.007 each. Instead:
  - the heartbeat warns at 70 % and 100 % of the free credits and shows projected month-end usage and cost
  - limits can be switched on later via config (per-user daily/monthly caps, global stop) without a code change
- Savings built into the Edge Function (these save money without limiting users):
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

## Owner decisions
- 2026-11-11: store IDs + display fields only; prices and buy links fetched fresh.
- 2026-11-11: Channel3 second-hand offers are the middle tier.
- 2026-11-11: no usage limits for now; overage reported in the heartbeat.
