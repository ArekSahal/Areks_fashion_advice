// channel3-search: the M1.5 Shop (#34), see docs/channel3.md. Called only when the user taps Search or opens a card.
//
// POST { action: 'search', query, filters } → { products, cached }
//   Cache hit (same normalised query + filters in the last 24 h): no paid call. The cached id list is refreshed
//   with the free product detail call, so prices, stock and buy links are always fresh.
//   Cache miss: logs one credit in api_usage first (no paid call goes unlogged), then calls POST /v1/search once,
//   asking for new and used offers together; second-hand is ranked first.
// POST { action: 'offer', product_id } → { product }
//   Free product detail call, used by the app for a fresh buy link when results are older than a few minutes.
//
// The CHANNEL3_API_KEY secret never leaves this function. Buy links are returned, never stored.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  PRODUCT_ID,
  SEARCH_CACHE_HOURS,
  SHOP_LOCALE,
  ShopInputError,
  type ShopProduct,
  buildChannel3Search,
  fromExternalProductRow,
  normalizeSearchInput,
  parseProduct,
  parseSearchResponse,
  searchCacheMaterial,
  toExternalProductRow,
} from '../../../src/lib/shop.ts';
import { logUsage } from '../_shared/usage.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const API = 'https://api.trychannel3.com';
const FEATURE = 'shop_search';
/** Marginal cost per search past the 1,000 free credits/month (docs/channel3.md); the heartbeat sums credits. */
const COST_PER_CREDIT_USD = 0.007;

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

/** Free product detail call (GET /v1/products/{id}) in the Swedish locale. Returns null on any failure. */
async function fetchProduct(key: string, userId: string, id: string): Promise<ShopProduct | null> {
  const params = new URLSearchParams(SHOP_LOCALE);
  try {
    const res = await fetch(`${API}/v1/products/${encodeURIComponent(id)}?${params}`, {
      headers: channel3Headers(key, userId),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn('channel3-search: product fetch failed', res.status);
      return null;
    }
    return parseProduct(await res.json());
  } catch (e) {
    console.warn('channel3-search: product fetch error', e);
    return null;
  }
}

async function fromCache(admin: Admin, key: string, userId: string, ids: string[]): Promise<ShopProduct[]> {
  const fresh = await Promise.all(ids.map((id) => fetchProduct(key, userId, id)));
  const missing = ids.filter((_, i) => !fresh[i]);
  const fallback = new Map<string, ShopProduct>();
  if (missing.length > 0) {
    const { data } = await admin.from('external_products').select('*').in('external_id', missing);
    for (const row of data ?? []) {
      const p = fromExternalProductRow(row);
      if (p) fallback.set(p.id, p);
    }
  }
  return ids
    .map((id, i) => fresh[i] ?? fallback.get(id) ?? null)
    .filter((p): p is ShopProduct => p !== null);
}

async function search(admin: Admin, apiKey: string, userId: string, body: unknown): Promise<Response> {
  let input;
  try {
    input = normalizeSearchInput(body);
  } catch (e) {
    if (e instanceof ShopInputError) return json({ error: e.code }, 400);
    throw e;
  }

  const cacheKey = await sha256Hex(searchCacheMaterial(input));
  const since = new Date(Date.now() - SEARCH_CACHE_HOURS * 3600_000).toISOString();
  const { data: hit, error: cacheError } = await admin
    .from('channel3_search_cache')
    .select('product_ids')
    .eq('cache_key', cacheKey)
    .gte('created_at', since)
    .maybeSingle();
  if (cacheError) console.warn('channel3-search: cache read failed', cacheError.message);
  if (hit?.product_ids) {
    const products = await fromCache(admin, apiKey, userId, hit.product_ids as string[]);
    console.log(JSON.stringify({ event: 'channel3-search.search', cached: true, results: products.length }));
    return json({ products, cached: true });
  }

  // Paid call: log the credit first, and don't call Channel3 if the log can't be written.
  const logged = await logUsage(admin, {
    user_id: userId,
    feature: FEATURE,
    provider: 'channel3',
    model: 'v1/search',
    units: 1,
    unit: 'credits',
    cost_estimate_usd: COST_PER_CREDIT_USD,
  });
  if (!logged) return json({ error: 'shop_unavailable' }, 503);

  const res = await fetch(`${API}/v1/search`, {
    method: 'POST',
    headers: channel3Headers(apiKey, userId),
    body: JSON.stringify(buildChannel3Search(input)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error('channel3-search: search failed', res.status, (await res.text()).slice(0, 300));
    return json({ error: 'shop_unavailable' }, 502);
  }
  const products = parseSearchResponse(await res.json(), input.filters);

  const now = new Date();
  if (products.length > 0) {
    const { error } = await admin
      .from('external_products')
      .upsert(products.map((p) => toExternalProductRow(p, now)), { onConflict: 'external_id' });
    if (error) console.warn('channel3-search: product cache write failed', error.message);
  }
  const { error: writeError } = await admin
    .from('channel3_search_cache')
    .upsert({ cache_key: cacheKey, product_ids: products.map((p) => p.id), created_at: now.toISOString() });
  if (writeError) console.warn('channel3-search: search cache write failed', writeError.message);

  console.log(JSON.stringify({ event: 'channel3-search.search', cached: false, results: products.length }));
  return json({ products, cached: false });
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
      const product = await fetchProduct(apiKey, userId, id);
      return product ? json({ product }) : json({ error: 'not_found' }, 404);
    }
    return json({ error: 'bad_request' }, 400);
  } catch (e) {
    console.error('channel3-search failed', e);
    return json({ error: 'shop_unavailable' }, 500);
  }
});
