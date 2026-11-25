// channel3-search: the M1.5 Shop (#34), see docs/channel3.md. Called only when the user taps Search or opens a card.
//
// POST { action: 'search', query, filters, allow_eu? } → { products, cached }
//   Cache hit (same normalised query + filters in the last 24 h): no paid call. The cached id list is refreshed
//   with the free product detail call, so prices, stock and buy links are always fresh.
//   Cache miss: logs one credit in api_usage first (no paid call goes unlogged), then calls POST /v1/search once,
//   asking for new and used offers together; second-hand is ranked first.
//   EU fallback (opt-in: only with allow_eu: true; without it the function is Swedish-only, as before):
//   if the Swedish search keeps fewer than EU_FALLBACK_MIN_SE_RESULTS cards, one more paid search runs
//   with the pan-European locale (logged first as model 'v1/search:eu'; skipped if the log fails). Its id list is
//   cached under its own EU key, so a cache hit refreshes each id in the locale it came from. EU cards come after
//   the Swedish ones and carry region: 'EU'.
// POST { action: 'offer', product_id, region? } → { product }
//   Free product detail call, used by the app for a fresh buy link when results are older than a few minutes.
//   region 'EU' fetches it in the EU locale (for EU cards).
//
// The CHANNEL3_API_KEY secret never leaves this function. Buy links are returned, never stored.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  PRODUCT_ID,
  SEARCH_CACHE_HOURS,
  ShopInputError,
  type ShopProduct,
  type ShopFilters,
  type ShopRegion,
  type ShopSearchInput,
  buildChannel3Search,
  filterAndRank,
  fromExternalProductRow,
  localeFor,
  mergeRegions,
  needsEuFallback,
  normalizeSearchInput,
  parseAllowEu,
  parseProduct,
  parseRegion,
  parseSearchResponse,
  searchCacheMaterial,
  toExternalProductRow,
} from '../../../src/lib/shop.ts';
import { logUsage, markUsageFailed } from '../_shared/usage.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const API = 'https://api.trychannel3.com';
const FEATURE = 'shop_search';
/** Marginal cost per search past the 1,000 free credits/month (docs/channel3.md); the heartbeat sums credits. */
const COST_PER_CREDIT_USD = 0.007;
/** Search timeouts: the Swedish search may take its time; the EU fallback is extra wait on top, so it's cut short. */
const SEARCH_TIMEOUT_MS = { SE: 15_000, EU: 7_000 } as const;

type Admin = ReturnType<typeof createClient>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function channel3Headers(key: string, userId: string) {
  // x-user-id: the opaque Supabase user id, for per-user click/sale attribution in Channel3 reporting.
  return { 'x-api-key': key, 'x-user-id': userId, 'Content-Type': 'application/json' };
}

/**
 * Free product detail call (GET /v1/products/{id}) in the region's locale (Swedish by default). Returns undefined if
 * the call failed (network, timeout, error status) and null if Channel3 answered with a product we can't show.
 */
async function fetchProduct(
  key: string,
  userId: string,
  id: string,
  region: ShopRegion = 'SE',
): Promise<ShopProduct | null | undefined> {
  const params = new URLSearchParams(localeFor(region));
  try {
    const res = await fetch(`${API}/v1/products/${encodeURIComponent(id)}?${params}`, {
      headers: channel3Headers(key, userId),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn('channel3-search: product fetch failed', res.status);
      return res.status === 404 ? null : undefined;
    }
    return parseProduct(await res.json(), region);
  } catch (e) {
    console.warn('channel3-search: product fetch error', e);
    return undefined;
  }
}

/**
 * Refreshes a cached id list with the free product call and runs it through the same filters and ranking as a fresh
 * search (sold-out items and offers over the cap drop out). Only a product whose fetch failed falls back to its
 * cached display fields.
 */
async function fromCache(
  admin: Admin,
  key: string,
  userId: string,
  ids: string[],
  filters: ShopFilters,
  region: ShopRegion,
): Promise<ShopProduct[]> {
  const fresh = await Promise.all(ids.map((id) => fetchProduct(key, userId, id, region)));
  const failed = ids.filter((_, i) => fresh[i] === undefined);
  const fallback = new Map<string, ShopProduct>();
  if (failed.length > 0) {
    const { data } = await admin.from('external_products').select('*').in('external_id', failed);
    for (const row of data ?? []) {
      const p = fromExternalProductRow(row, filters, region);
      if (p) fallback.set(p.id, p);
    }
  }
  const loaded = filterAndRank(fresh.map((p) => p ?? null), filters);
  const offline = ids.map((id) => fallback.get(id)).filter((p): p is ShopProduct => p !== undefined);
  return [...loaded, ...offline];
}

/** Cached id list for this search and region (24 h), or null on a miss. */
async function readCache(admin: Admin, cacheKey: string): Promise<string[] | null> {
  const since = new Date(Date.now() - SEARCH_CACHE_HOURS * 3600_000).toISOString();
  const { data, error } = await admin
    .from('channel3_search_cache')
    .select('product_ids')
    .eq('cache_key', cacheKey)
    .gte('created_at', since)
    .maybeSingle();
  if (error) console.warn('channel3-search: cache read failed', error.message);
  return Array.isArray(data?.product_ids) ? (data.product_ids as string[]) : null;
}

/**
 * One paid search in one region: logs the credit first and makes no call if the log can't be written. Caches the
 * display rows and the id list (also an empty list, so the same search doesn't pay again within 24 h).
 * Returns 'not_logged' (no call made) or 'failed' (call made, row marked failed) instead of products.
 */
async function paidSearch(
  admin: Admin,
  apiKey: string,
  userId: string,
  input: ShopSearchInput,
  region: ShopRegion,
  cacheKey: string,
): Promise<ShopProduct[] | 'not_logged' | 'failed'> {
  const usageId = crypto.randomUUID();
  const logged = await logUsage(admin, {
    id: usageId,
    user_id: userId,
    feature: FEATURE,
    provider: 'channel3',
    model: region === 'EU' ? 'v1/search:eu' : 'v1/search',
    units: 1,
    unit: 'credits',
    cost_estimate_usd: COST_PER_CREDIT_USD,
  });
  if (!logged) return 'not_logged';

  let raw: unknown;
  try {
    const res = await fetch(`${API}/v1/search`, {
      method: 'POST',
      headers: channel3Headers(apiKey, userId),
      body: JSON.stringify(buildChannel3Search(input, region)),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS[region]),
    });
    if (!res.ok) throw new Error(`status ${res.status}: ${(await res.text()).slice(0, 300)}`);
    raw = await res.json();
  } catch (e) {
    console.error('channel3-search: search failed', region, e);
    await markUsageFailed(admin, usageId);
    return 'failed';
  }
  const products = parseSearchResponse(raw, input.filters, region);

  const now = new Date();
  if (products.length > 0) {
    // Keyed by product id only, so a product seen in both regions keeps the last region's price/currency. Those
    // fields only feed the offline fallback card (fromExternalProductRow), which drops a row whose currency doesn't
    // match the region's cap, so a mismatch errs on the safe side (card hidden, never a wrong price).
    const { error } = await admin
      .from('external_products')
      .upsert(products.map((p) => toExternalProductRow(p, now)), { onConflict: 'external_id' });
    if (error) console.warn('channel3-search: product cache write failed', error.message);
  }
  const { error: writeError } = await admin
    .from('channel3_search_cache')
    .upsert({ cache_key: cacheKey, product_ids: products.map((p) => p.id), created_at: now.toISOString() });
  if (writeError) console.warn('channel3-search: search cache write failed', writeError.message);
  return products;
}

async function search(admin: Admin, apiKey: string, userId: string, body: unknown): Promise<Response> {
  const started = Date.now();
  let input;
  let allowEu: boolean;
  try {
    input = normalizeSearchInput(body);
    allowEu = parseAllowEu((body as { allow_eu?: unknown } | null)?.allow_eu);
  } catch (e) {
    if (e instanceof ShopInputError) return json({ error: e.code }, 400);
    throw e;
  }
  const done = (products: ShopProduct[], cached: boolean, euFallback: boolean) => {
    console.log(
      JSON.stringify({
        event: 'channel3-search.search',
        cached,
        results: products.length,
        eu_fallback: euFallback,
        duration_ms: Date.now() - started,
      }),
    );
    return json({ products, cached });
  };

  const seKey = await sha256Hex(searchCacheMaterial(input, 'SE'));
  const euKey = allowEu ? await sha256Hex(searchCacheMaterial(input, 'EU')) : null;
  const seIds = await readCache(admin, seKey);
  if (seIds) {
    // The EU list only exists if this search was thin and the fallback ran; a hit never pays for a new fallback.
    const euIds = euKey && needsEuFallback(seIds.length) ? await readCache(admin, euKey) : null;
    const [se, eu] = await Promise.all([
      fromCache(admin, apiKey, userId, seIds, input.filters, 'SE'),
      euIds?.length ? fromCache(admin, apiKey, userId, euIds, input.filters, 'EU') : Promise.resolve([]),
    ]);
    // Without EU cards the Swedish list is returned untouched (same as before the fallback existed).
    return done(eu.length ? mergeRegions(se, eu) : se, true, euIds !== null);
  }

  const se = await paidSearch(admin, apiKey, userId, input, 'SE', seKey);
  if (se === 'not_logged') return json({ error: 'shop_unavailable' }, 503);
  if (se === 'failed') return json({ error: 'shop_unavailable' }, 502);
  if (!euKey || !needsEuFallback(se.length)) return done(se, false, false);

  // EU fallback: one more credit, only when the Swedish results are thin. Its failure never hides the Swedish ones.
  // Reuse a still-valid EU list (e.g. the Swedish cache write failed last time) before paying again.
  let eu: ShopProduct[] = [];
  const euIds = await readCache(admin, euKey);
  if (euIds) {
    eu = euIds.length ? await fromCache(admin, apiKey, userId, euIds, input.filters, 'EU') : [];
  } else {
    const result = await paidSearch(admin, apiKey, userId, input, 'EU', euKey);
    if (Array.isArray(result)) eu = result;
  }
  return done(eu.length ? mergeRegions(se, eu) : se, false, true);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('CHANNEL3_API_KEY');

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);
  const userId = auth.user.id;

  if (!apiKey) {
    console.error('channel3-search: CHANNEL3_API_KEY is not set');
    return json({ error: 'shop_unavailable' }, 503);
  }

  const body = await req.json().catch(() => null);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    if (body?.action === 'search') return await search(admin, apiKey, userId, body);
    if (body?.action === 'offer') {
      const id = body.product_id;
      if (typeof id !== 'string' || !PRODUCT_ID.test(id)) return json({ error: 'invalid_product_id' }, 400);
      let region: ShopRegion;
      try {
        region = parseRegion(body.region);
      } catch (e) {
        if (e instanceof ShopInputError) return json({ error: e.code }, 400);
        throw e;
      }
      const product = await fetchProduct(apiKey, userId, id, region);
      if (product === undefined) return json({ error: 'shop_unavailable' }, 502);
      return product ? json({ product }) : json({ error: 'not_found' }, 404);
    }
    return json({ error: 'bad_request' }, 400);
  } catch (e) {
    console.error('channel3-search failed', e);
    return json({ error: 'shop_unavailable' }, 500);
  }
});
