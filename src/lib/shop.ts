/**
 * M1.5 Shop: Channel3 search contract (owner: Market agent, see docs/channel3.md).
 *
 * Pure TypeScript with no imports beyond types, so the same file runs in the `channel3-search` Edge Function
 * (Deno, explicit `.ts` path) and in Vitest. Network calls, the cache tables and usage logging live in the function.
 *
 * Rules from docs/channel3.md and docs/DECISIONS.md:
 * - Locale Sweden, prices in SEK, English titles (the app is English-only).
 * - One paid search per user search: we ask for new AND used offers in the same call and rank second-hand first,
 *   instead of two calls (used, then new).
 * - The buy link (offer url) is never stored. toExternalProductRow() drops it.
 * - Commission is only a tie-breaker between otherwise equal offers.
 */
import type { Category } from './taxonomy.ts';

export const SHOP_CATEGORIES = ['top', 'bottom', 'one_piece', 'outerwear', 'footwear', 'accessory'] as const satisfies readonly Category[];
export type ShopCategory = (typeof SHOP_CATEGORIES)[number];
export const SHOP_GENDERS = ['female', 'male'] as const;
export type ShopGender = (typeof SHOP_GENDERS)[number];
export const SHOP_MAX_PRICES = [500, 1000, 2000] as const;
export type ShopMaxPrice = (typeof SHOP_MAX_PRICES)[number];

export type ShopFilters = {
  category?: ShopCategory | null;
  gender?: ShopGender | null;
  /** SEK, inclusive. */
  maxPrice?: ShopMaxPrice | null;
  /** true = only second-hand offers. Default: new and used, second-hand ranked first. */
  usedOnly?: boolean;
};

export type ShopSearchInput = { query: string; filters: ShopFilters };

export const MAX_QUERY_LENGTH = 100;
export const SHOP_RESULT_LIMIT = 12;
export const SHOP_LOCALE = { country: 'SE', currency: 'SEK', language: 'en' } as const;
/** How long a search result (ordered list of product ids) is reused. */
export const SEARCH_CACHE_HOURS = 24;
/** Offer links are short-lived affiliate links: after this the app asks for a fresh one before opening it. */
export const OFFER_FRESH_MINUTES = 15;
/** Channel3 product ids are short opaque strings (e.g. "2yh8WH5"). */
export const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Word added to the text query for a category. Channel3 category slugs need a paid lookup, so we use words. */
const CATEGORY_QUERY: Record<ShopCategory, string> = {
  top: 'top',
  bottom: 'trousers',
  one_piece: 'dress',
  outerwear: 'jacket',
  footwear: 'shoes',
  accessory: 'accessory',
};

export type ShopInputErrorCode = 'empty_query' | 'query_too_long' | 'invalid_filter';

export class ShopInputError extends Error {
  readonly code: ShopInputErrorCode;
  constructor(code: ShopInputErrorCode) {
    super(code);
    this.code = code;
    this.name = 'ShopInputError';
  }
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[]): T | null {
  if (value === undefined || value === null) return null;
  if (!(allowed as readonly unknown[]).includes(value)) throw new ShopInputError('invalid_filter');
  return value as T;
}

/**
 * Validates untrusted input (the Edge Function's request body) and returns a canonical form: trimmed, lower-case,
 * single-spaced query and only known filter values. Two searches that mean the same thing get the same form,
 * so they share one cache entry.
 */
export function normalizeSearchInput(raw: unknown): Required<ShopSearchInput> & { filters: Required<ShopFilters> } {
  const body = (raw ?? {}) as { query?: unknown; filters?: Record<string, unknown> };
  const query = typeof body.query === 'string' ? body.query.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  if (query.length > MAX_QUERY_LENGTH) throw new ShopInputError('query_too_long');
  const f = body.filters && typeof body.filters === 'object' ? body.filters : {};
  if (f.usedOnly !== undefined && typeof f.usedOnly !== 'boolean') throw new ShopInputError('invalid_filter');
  const filters = {
    category: oneOf(f.category, SHOP_CATEGORIES),
    gender: oneOf(f.gender, SHOP_GENDERS),
    maxPrice: oneOf(f.maxPrice, SHOP_MAX_PRICES),
    usedOnly: f.usedOnly === true,
  };
  if (!query && !filters.category) throw new ShopInputError('empty_query');
  return { query, filters };
}

/** Stable string for the search-result cache key (hashed by the caller). Includes the locale and result limit. */
export function searchCacheMaterial(input: ShopSearchInput): string {
  const f = input.filters;
  return JSON.stringify([
    'v1',
    SHOP_LOCALE.country,
    SHOP_LOCALE.currency,
    SHOP_LOCALE.language,
    SHOP_RESULT_LIMIT,
    input.query,
    f.category ?? null,
    f.gender ?? null,
    f.maxPrice ?? null,
    f.usedOnly === true,
  ]);
}

/** Request body for Channel3 `POST /v1/search` (schema checked 2026-11-15). */
export function buildChannel3Search(input: ShopSearchInput) {
  const f = input.filters;
  const words = [input.query, f.category ? CATEGORY_QUERY[f.category] : ''].filter(Boolean);
  const filters: Record<string, unknown> = {
    availability: ['InStock'],
    // Both values = no condition filter, so one call returns used and new offers.
    conditions: f.usedOnly ? ['used'] : ['new', 'used'],
    age: ['adult'],
  };
  if (f.gender) filters.gender = f.gender;
  if (f.maxPrice) filters.price = { max_price: f.maxPrice };
  return {
    query: words.join(' '),
    limit: SHOP_RESULT_LIMIT,
    filters,
    config: { ...SHOP_LOCALE, mode: 'default' },
  };
}

export type ShopOffer = {
  /** Affiliate buy link. Short-lived; never stored. */
  url: string;
  domain: string;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  condition: 'new' | 'used' | null;
  commission: number;
};

export type ShopProduct = {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  categorySlug: string | null;
  gender: ShopGender | null;
  materials: string[];
  offer: ShopOffer | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseOffer(raw: unknown): (ShopOffer & { inStock: boolean }) | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const url = str(o.url);
  const domain = str(o.domain)?.slice(0, 255) ?? null;
  const p = o.price as Record<string, unknown> | null;
  const price = num(p?.price);
  const currency = str(p?.currency);
  if (!url || !/^https:\/\//i.test(url) || !domain || price === null || price < 0 || !currency) return null;
  const condition = o.condition === 'new' || o.condition === 'used' ? o.condition : null;
  const compare = num(p?.compare_at_price);
  return {
    url,
    domain,
    price,
    compareAtPrice: compare !== null && compare > price ? compare : null,
    currency: currency.toUpperCase(),
    condition,
    commission: Math.max(0, num(o.max_commission_rate) ?? 0),
    inStock: o.availability !== 'OutOfStock',
  };
}

/**
 * Best offer for the card: only in-stock offers; second-hand first, then the lowest price, then the highest
 * commission as the last tie-breaker (docs/channel3.md → Ranking). null = nothing buyable right now.
 */
export function pickBestOffer(rawOffers: unknown): ShopOffer | null {
  if (!Array.isArray(rawOffers)) return null;
  const offers = rawOffers.map(parseOffer).filter((o): o is NonNullable<typeof o> => o !== null && o.inStock);
  offers.sort(
    (a, b) =>
      Number(b.condition === 'used') - Number(a.condition === 'used') ||
      a.price - b.price ||
      b.commission - a.commission,
  );
  const best = offers[0];
  if (!best) return null;
  const { inStock: _inStock, ...offer } = best;
  return offer;
}

function mainImage(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const images = raw.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  const img = images.find((i) => i.is_main_image === true) ?? images[0];
  const url = str(img?.cleaned_url) ?? str(img?.url);
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** Parses one Channel3 Product. Returns null for anything we can't show (no id or title). */
export function parseProduct(raw: unknown): ShopProduct | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;
  const id = str(p.id);
  const title = str(p.title);
  if (!id || !PRODUCT_ID.test(id) || !title) return null;
  const brands = Array.isArray(p.brands) ? p.brands : [];
  const category = p.category as Record<string, unknown> | null;
  return {
    id,
    title: title.slice(0, 200),
    brand: str((brands[0] as Record<string, unknown> | undefined)?.name)?.slice(0, 200) ?? null,
    imageUrl: mainImage(p.images),
    categorySlug: str(category?.slug)?.slice(0, 200) ?? null,
    gender: p.gender === 'male' || p.gender === 'female' ? p.gender : null,
    materials: Array.isArray(p.materials) ? p.materials.filter((m): m is string => typeof m === 'string').slice(0, 8) : [],
    offer: pickBestOffer(p.offers),
  };
}

/** Does a fully loaded card pass the user's filters? Needs a buyable offer; enforces the price cap and used-only. */
export function passesFilters(p: ShopProduct, filters: ShopFilters = {}): boolean {
  if (!p.offer) return false;
  // The cap is also sent to Channel3; this guards against offers in another currency or a stale cached price.
  if (filters.maxPrice && (p.offer.currency !== 'SEK' || p.offer.price > filters.maxPrice)) return false;
  if (filters.usedOnly && p.offer.condition !== 'used') return false;
  return true;
}

/**
 * Filters, de-duplicates and ranks cards: second-hand offers first, keeping Channel3's relevance order within each
 * group. Used for fresh search results and for cached results refreshed with the product call, so both behave alike.
 */
export function filterAndRank(products: readonly (ShopProduct | null)[], filters: ShopFilters = {}): ShopProduct[] {
  const seen = new Set<string>();
  const kept: ShopProduct[] = [];
  for (const p of products) {
    if (!p || seen.has(p.id) || !passesFilters(p, filters)) continue;
    seen.add(p.id);
    kept.push(p);
  }
  return rankSecondHandFirst(kept);
}

/** Turns a Channel3 SearchResponse into the cards we show (see filterAndRank). */
export function parseSearchResponse(raw: unknown, filters: ShopFilters = {}): ShopProduct[] {
  const list = (raw as { products?: unknown } | null)?.products;
  if (!Array.isArray(list)) return [];
  return filterAndRank(list.map(parseProduct), filters);
}

export function rankSecondHandFirst(products: readonly ShopProduct[]): ShopProduct[] {
  const used = products.filter((p) => p.offer?.condition === 'used');
  return [...used, ...products.filter((p) => p.offer?.condition !== 'used')];
}

/** Row for public.external_products: display fields + price for ranking. Never the buy link. */
export function toExternalProductRow(p: ShopProduct, now: Date = new Date()) {
  return {
    external_id: p.id,
    title: p.title,
    brand: p.brand,
    image_url: p.imageUrl,
    category_slug: p.categorySlug,
    gender: p.gender,
    materials: p.materials,
    price: p.offer?.price ?? null,
    currency: p.offer?.currency ?? null,
    condition: p.offer?.condition ?? null,
    offer_domain: p.offer?.domain ?? null,
    refreshed_at: now.toISOString(),
  };
}

/**
 * Card shown from the cache when the fresh product call fails: display fields only, no offer (the app fetches a
 * link when it's tapped). Returns null if the cached row doesn't pass the filters (price cap, used-only).
 */
export function fromExternalProductRow(row: Record<string, unknown>, filters: ShopFilters = {}): ShopProduct | null {
  const id = str(row.external_id);
  const title = str(row.title);
  if (!id || !title) return null;
  const price = typeof row.price === 'number' ? row.price : Number(row.price);
  if (filters.usedOnly && row.condition !== 'used') return null;
  if (filters.maxPrice && (row.currency !== 'SEK' || !Number.isFinite(price) || price > filters.maxPrice)) return null;
  return {
    id,
    title,
    brand: str(row.brand),
    imageUrl: str(row.image_url),
    categorySlug: str(row.category_slug),
    gender: row.gender === 'male' || row.gender === 'female' ? row.gender : null,
    materials: Array.isArray(row.materials) ? (row.materials as unknown[]).filter((m): m is string => typeof m === 'string') : [],
    offer: null,
  };
}

/** "1,299 kr" for SEK, "€49" style for others. Whole units; Channel3 prices include discounts. */
export function formatPrice(price: number, currency: string): string {
  const whole = Math.round(price)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (currency === 'SEK') return `${whole} kr`;
  const symbol: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
  return symbol[currency] ? `${symbol[currency]}${whole}` : `${whole} ${currency}`;
}

/** Display labels (English-only app). */
export const SHOP_CATEGORY_LABELS: Record<ShopCategory, string> = {
  top: 'Tops',
  bottom: 'Bottoms',
  one_piece: 'Dresses',
  outerwear: 'Outerwear',
  footwear: 'Shoes',
  accessory: 'Accessories',
};
export const SHOP_GENDER_LABELS: Record<ShopGender, string> = { female: 'Women', male: 'Men' };
