import { OFFER_FRESH_MINUTES, type ShopProduct, type ShopSearchInput } from './shop';
import { supabase } from './supabase';

export type ShopResults = { products: ShopProduct[]; cached: boolean; fetchedAt: number };

/** Runs one Shop search through the channel3-search Edge Function. Only call this on an explicit user action. */
export async function searchShop(input: ShopSearchInput): Promise<ShopResults> {
  const { data, error } = await supabase.functions.invoke<{ products: ShopProduct[]; cached: boolean }>('channel3-search', {
    body: { action: 'search', query: input.query, filters: input.filters },
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.products)) throw new Error('Empty response');
  return { products: data.products, cached: data.cached === true, fetchedAt: Date.now() };
}

/**
 * The buy link to open for a card. Links from a search are used as they are while fresh; older ones (or cards
 * shown from the cache without an offer) get a fresh link through the free product call.
 */
export async function offerUrl(product: ShopProduct, fetchedAt: number, now: number = Date.now()): Promise<string | null> {
  if (product.offer && now - fetchedAt < OFFER_FRESH_MINUTES * 60_000) return product.offer.url;
  const { data, error } = await supabase.functions.invoke<{ product: ShopProduct }>('channel3-search', {
    body: { action: 'offer', product_id: product.id },
  });
  if (error || !data?.product?.offer) return null;
  return data.product.offer.url;
}
