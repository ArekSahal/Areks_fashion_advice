import { OFFER_FRESH_MINUTES, type ShopProduct, type ShopSearchInput } from './shop';
import { supabase } from './supabase';

export type ShopResults = { products: ShopProduct[]; cached: boolean; fetchedAt: number };

/**
 * Runs one Shop search through the channel3-search Edge Function. Only call this on an explicit user action.
 * `allow_eu` opts in to the EU fallback for thin Swedish results (EU cards come back with region 'EU').
 */
export async function searchShop(input: ShopSearchInput): Promise<ShopResults> {
  const { data, error } = await supabase.functions.invoke<{ products: ShopProduct[]; cached: boolean }>('channel3-search', {
    body: { action: 'search', query: input.query, filters: input.filters, allow_eu: true },
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.products)) throw new Error('Empty response');
  return { products: data.products, cached: data.cached === true, fetchedAt: Date.now() };
}

/**
 * The buy link from the search results, if it is still fresh enough to open right away. Offer links are short-lived
 * affiliate links, so after OFFER_FRESH_MINUTES (or for cards shown from the cache without an offer) use
 * fetchOfferUrl() instead.
 */
export function freshOfferUrl(product: ShopProduct, fetchedAt: number, now: number = Date.now()): string | null {
  return product.offer && now - fetchedAt < OFFER_FRESH_MINUTES * 60_000 ? product.offer.url : null;
}

/**
 * A fresh buy link through the free product call, in the card's region (EU cards are fetched in the EU locale).
 * null if the product is gone or has no offer.
 */
export async function fetchOfferUrl(product: Pick<ShopProduct, 'id' | 'region'>): Promise<string | null> {
  const body = product.region === 'EU'
    ? { action: 'offer', product_id: product.id, region: 'EU' }
    : { action: 'offer', product_id: product.id };
  const { data, error } = await supabase.functions.invoke<{ product: ShopProduct }>('channel3-search', { body });
  if (error || !data?.product?.offer) return null;
  return data.product.offer.url;
}
