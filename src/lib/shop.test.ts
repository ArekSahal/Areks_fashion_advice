import { describe, expect, it } from 'vitest';
import {
  EU_FALLBACK_MIN_SE_RESULTS,
  SEK_PER_EUR,
  SHOP_RESULT_LIMIT,
  ShopInputError,
  buildChannel3Search,
  filterAndRank,
  formatPrice,
  fromExternalProductRow,
  localeFor,
  mergeRegions,
  needsEuFallback,
  normalizeSearchInput,
  parseRegion,
  parseProduct,
  parseSearchResponse,
  passesFilters,
  pickBestOffer,
  priceCapFor,
  searchCacheMaterial,
  toExternalProductRow,
  type ShopProduct,
} from './shop';

const offer = (over: Record<string, unknown> = {}) => ({
  url: 'https://buy.trychannel3.com/abc',
  domain: 'shop.se',
  price: { price: 799, currency: 'SEK', compare_at_price: null },
  availability: 'InStock',
  condition: 'new',
  max_commission_rate: 0.05,
  ...over,
});

const product = (id: string, offers: unknown[], over: Record<string, unknown> = {}) => ({
  id,
  title: `Wool coat ${id}`,
  brands: [{ id: 'b1', name: 'Acme' }],
  images: [
    { url: 'https://img.example/a.jpg', is_main_image: false },
    { url: 'https://img.example/main.jpg', cleaned_url: 'https://cdn.channel3/main.png', is_main_image: true },
  ],
  category: { slug: 'coats', title: 'Coats' },
  gender: 'female',
  materials: ['wool'],
  offers,
  ...over,
});

describe('normalizeSearchInput', () => {
  it('trims, lower-cases and collapses spaces so equal searches share a cache key', () => {
    const a = normalizeSearchInput({ query: '  Black   Wool Coat ', filters: { gender: 'female' } });
    const b = normalizeSearchInput({ query: 'black wool coat', filters: { gender: 'female', usedOnly: false } });
    expect(a.query).toBe('black wool coat');
    expect(searchCacheMaterial(a)).toBe(searchCacheMaterial(b));
  });

  it('keys differ when a filter differs', () => {
    const a = normalizeSearchInput({ query: 'coat', filters: {} });
    const b = normalizeSearchInput({ query: 'coat', filters: { usedOnly: true } });
    expect(searchCacheMaterial(a)).not.toBe(searchCacheMaterial(b));
  });

  it('allows a category without text, but not an empty search', () => {
    expect(normalizeSearchInput({ query: '', filters: { category: 'footwear' } }).filters.category).toBe('footwear');
    expect(() => normalizeSearchInput({ query: '   ', filters: {} })).toThrow(ShopInputError);
    expect(() => normalizeSearchInput(null)).toThrow(ShopInputError);
  });

  it('rejects unknown filter values and long queries', () => {
    expect(() => normalizeSearchInput({ query: 'x', filters: { gender: 'unisex' } })).toThrow('invalid_filter');
    expect(() => normalizeSearchInput({ query: 'x', filters: { maxPrice: 123 } })).toThrow('invalid_filter');
    expect(() => normalizeSearchInput({ query: 'x', filters: { usedOnly: 'yes' } })).toThrow('invalid_filter');
    expect(() => normalizeSearchInput({ query: 'a'.repeat(101), filters: {} })).toThrow('query_too_long');
  });
});

describe('buildChannel3Search', () => {
  it('asks for new and used offers in one call, in stock, adults, Swedish locale in English', () => {
    const body = buildChannel3Search(normalizeSearchInput({ query: 'linen shirt', filters: {} }));
    expect(body).toEqual({
      query: 'linen shirt',
      limit: SHOP_RESULT_LIMIT,
      filters: { availability: ['InStock'], conditions: ['new', 'used'], age: ['adult'] },
      config: { country: 'SE', currency: 'SEK', language: 'en', mode: 'default' },
    });
  });

  it('maps filters: category word, gender, price cap, used only', () => {
    const body = buildChannel3Search(
      normalizeSearchInput({ query: 'black', filters: { category: 'footwear', gender: 'male', maxPrice: 1000, usedOnly: true } }),
    );
    expect(body.query).toBe('black shoes');
    expect(body.filters).toMatchObject({ gender: 'male', price: { max_price: 1000 }, conditions: ['used'] });
  });

  it('never sends a size, colour or anything personal', () => {
    const body = JSON.stringify(buildChannel3Search(normalizeSearchInput({ query: 'coat', filters: {} })));
    expect(body).not.toMatch(/user|email|size/i);
  });
});

describe('pickBestOffer', () => {
  it('skips sold-out offers, prefers second-hand, then cheaper, commission only as the last tie-breaker', () => {
    const best = pickBestOffer([
      offer({ url: 'https://a/out', availability: 'OutOfStock', condition: 'used', price: { price: 10, currency: 'SEK' } }),
      offer({ url: 'https://a/new-cheap', price: { price: 100, currency: 'SEK' }, max_commission_rate: 0.5 }),
      offer({ url: 'https://a/used', condition: 'used', price: { price: 300, currency: 'SEK' } }),
    ]);
    expect(best?.url).toBe('https://a/used');

    const tie = pickBestOffer([
      offer({ url: 'https://a/low', max_commission_rate: 0.02 }),
      offer({ url: 'https://a/high', max_commission_rate: 0.1 }),
    ]);
    expect(tie?.url).toBe('https://a/high');
  });

  it('drops offers without an https link or a price', () => {
    expect(pickBestOffer([offer({ url: 'http://insecure' }), offer({ price: { currency: 'SEK' } })])).toBeNull();
    expect(pickBestOffer('nope')).toBeNull();
  });

  it('keeps compare-at price only when it is higher than the price', () => {
    expect(pickBestOffer([offer({ price: { price: 500, currency: 'sek', compare_at_price: 800 } })])).toMatchObject({
      compareAtPrice: 800,
      currency: 'SEK',
    });
    expect(pickBestOffer([offer({ price: { price: 500, currency: 'SEK', compare_at_price: 400 } })])?.compareAtPrice).toBeNull();
  });
});

describe('parseProduct / parseSearchResponse', () => {
  it('uses the background-removed main image and the first brand', () => {
    const p = parseProduct(product('p1', [offer()]));
    expect(p).toMatchObject({ id: 'p1', brand: 'Acme', imageUrl: 'https://cdn.channel3/main.png', categorySlug: 'coats' });
  });

  it('skips products without id, title or a buyable offer, and duplicates', () => {
    const res = parseSearchResponse({
      products: [
        product('ok', [offer()]),
        product('ok', [offer()]),
        product('bad id!', [offer()]),
        { id: 'notitle', offers: [offer()] },
        product('nooffer', []),
      ],
    });
    expect(res.map((p) => p.id)).toEqual(['ok']);
  });

  it('puts second-hand first and keeps Channel3 order within each group', () => {
    const res = parseSearchResponse({
      products: [
        product('new1', [offer()]),
        product('used1', [offer({ condition: 'used' })]),
        product('new2', [offer()]),
        product('used2', [offer({ condition: 'used' })]),
      ],
    });
    expect(res.map((p) => p.id)).toEqual(['used1', 'used2', 'new1', 'new2']);
  });

  it('enforces the SEK price cap and used-only even if Channel3 returns more', () => {
    const raw = {
      products: [
        product('cheap', [offer({ price: { price: 400, currency: 'SEK' } })]),
        product('pricey', [offer({ price: { price: 900, currency: 'SEK' } })]),
      ],
    };
    expect(parseSearchResponse(raw, { maxPrice: 500 }).map((p) => p.id)).toEqual(['cheap']);
    expect(parseSearchResponse(raw, { usedOnly: true })).toEqual([]);
  });

  it('returns nothing for junk', () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({ products: 'x' })).toEqual([]);
  });
});

describe('filterAndRank (cache hits use the same rules as fresh searches)', () => {
  it('drops refreshed products that sold out, went over the cap or are no longer second-hand', () => {
    const fresh = [
      parseProduct(product('soldout', [offer({ availability: 'OutOfStock' })])),
      parseProduct(product('gone', [])),
      null,
      parseProduct(product('newnow', [offer()])),
      parseProduct(product('used', [offer({ condition: 'used', price: { price: 450, currency: 'SEK' } })])),
      parseProduct(product('eur', [offer({ condition: 'used', price: { price: 40, currency: 'EUR' } })])),
    ];
    expect(filterAndRank(fresh, { usedOnly: true, maxPrice: 500 }).map((p) => p.id)).toEqual(['used']);
    expect(filterAndRank(fresh).map((p) => p.id)).toEqual(['used', 'eur', 'newnow']);
  });

  it('never lets an offer in another currency past a SEK price cap', () => {
    const p = parseProduct(product('eur', [offer({ price: { price: 10, currency: 'EUR' } })]));
    expect(filterAndRank([p], { maxPrice: 500 })).toEqual([]);
  });
});

describe('external_products rows', () => {
  it('never stores the buy link', () => {
    const p = parseProduct(product('p1', [offer()]))!;
    const row = toExternalProductRow(p, new Date('2026-11-15T12:00:00Z'));
    expect(JSON.stringify(row)).not.toContain('buy.trychannel3.com');
    expect(row).toMatchObject({ external_id: 'p1', price: 799, currency: 'SEK', offer_domain: 'shop.se' });
  });

  it('turns a cached row back into a card without an offer', () => {
    const p = parseProduct(product('p1', [offer()]))!;
    const back = fromExternalProductRow(toExternalProductRow(p));
    expect(back).toMatchObject({ id: 'p1', title: p.title, offer: null });
  });

  it('applies the filters to cached rows too (price may come back from Postgres as a string)', () => {
    const row = { ...toExternalProductRow(parseProduct(product('p1', [offer()]))!), price: '799.00' };
    expect(fromExternalProductRow(row, { usedOnly: true })).toBeNull();
    expect(fromExternalProductRow(row, { maxPrice: 500 })).toBeNull();
    expect(fromExternalProductRow(row, { maxPrice: 1000 })?.id).toBe('p1');
  });

  it('cuts long brand and category values to the column limits', () => {
    const p = parseProduct(product('p1', [offer()], { brands: [{ id: 'b', name: 'x'.repeat(300) }], category: { slug: 'y'.repeat(300) } }))!;
    expect(p.brand).toHaveLength(200);
    expect(p.categorySlug).toHaveLength(200);
  });
});

describe('formatPrice', () => {
  it('formats SEK and common currencies', () => {
    expect(formatPrice(1299, 'SEK')).toBe('1,299 kr');
    expect(formatPrice(49.5, 'EUR')).toBe('€50');
    expect(formatPrice(12, 'CZK')).toBe('12 CZK');
  });
});

describe('EU fallback', () => {
  const eurOffer = (price: number, over: Record<string, unknown> = {}) =>
    offer({ domain: 'shop.de', price: { price, currency: 'EUR' }, ...over });
  const card = (id: string, over: Partial<ShopProduct> = {}): ShopProduct => ({
    ...parseProduct(product(id, [offer()]))!,
    ...over,
  });

  it('uses the documented pan-European locale for EU and Sweden by default', () => {
    expect(localeFor('SE')).toEqual({ country: 'SE', currency: 'SEK', language: 'en' });
    expect(localeFor('EU')).toEqual({ country: 'EU', currency: 'EUR', language: 'en' });
  });

  it('accepts only SE or EU as a region from the request body', () => {
    expect(parseRegion(undefined)).toBe('SE');
    expect(parseRegion(null)).toBe('SE');
    expect(parseRegion('SE')).toBe('SE');
    expect(parseRegion('EU')).toBe('EU');
    expect(() => parseRegion('DE')).toThrow(ShopInputError);
    expect(() => parseRegion(1)).toThrow(ShopInputError);
  });

  it('runs only when the Swedish search keeps fewer than the threshold', () => {
    expect(EU_FALLBACK_MIN_SE_RESULTS).toBe(4);
    expect(needsEuFallback(0)).toBe(true);
    expect(needsEuFallback(EU_FALLBACK_MIN_SE_RESULTS - 1)).toBe(true);
    expect(needsEuFallback(EU_FALLBACK_MIN_SE_RESULTS)).toBe(false);
    expect(needsEuFallback(SHOP_RESULT_LIMIT)).toBe(false);
  });

  it('turns the SEK cap into a lower-or-equal EUR cap, rounded down', () => {
    expect(priceCapFor(1000, 'SE')).toEqual({ currency: 'SEK', amount: 1000 });
    expect(priceCapFor(500, 'EU')).toEqual({ currency: 'EUR', amount: 41 });
    expect(priceCapFor(1000, 'EU')).toEqual({ currency: 'EUR', amount: 83 });
    expect(priceCapFor(2000, 'EU')).toEqual({ currency: 'EUR', amount: 166 });
    // Never above the SEK cap at the conservative rate.
    for (const sek of [500, 1000, 2000]) expect(priceCapFor(sek, 'EU').amount * SEK_PER_EUR).toBeLessThanOrEqual(sek);
  });

  it('builds the EU request with the EU locale and the price cap in EUR', () => {
    const input = normalizeSearchInput({ query: 'coat', filters: { maxPrice: 1000 } });
    const body = buildChannel3Search(input, 'EU');
    expect(body.config).toEqual({ country: 'EU', currency: 'EUR', language: 'en', mode: 'default' });
    expect(body.filters).toMatchObject({ price: { max_price: 83 } });
    expect(buildChannel3Search(input)).toEqual(buildChannel3Search(input, 'SE'));
  });

  it('keeps the Swedish cache key unchanged and gives EU its own key', () => {
    const input = normalizeSearchInput({ query: 'coat', filters: {} });
    expect(searchCacheMaterial(input)).toBe(searchCacheMaterial(input, 'SE'));
    expect(searchCacheMaterial(input)).toBe(JSON.stringify(['v1', 'SE', 'SEK', 'en', SHOP_RESULT_LIMIT, 'coat', null, null, null, false]));
    expect(searchCacheMaterial(input, 'EU')).not.toBe(searchCacheMaterial(input, 'SE'));
    expect(searchCacheMaterial(input, 'EU')).toContain('"EUR"');
  });

  it('marks EU cards with region EU and leaves Swedish cards without a region', () => {
    expect(parseProduct(product('se', [offer()]))).not.toHaveProperty('region');
    expect(parseProduct(product('eu', [eurOffer(40)]), 'EU')?.region).toBe('EU');
  });

  it('applies the price cap in EUR to EU cards and still drops SEK-capped non-SEK Swedish cards', () => {
    const raw = { products: [product('cheap', [eurOffer(40)]), product('pricey', [eurOffer(90)]), product('sek', [offer({ price: { price: 300, currency: 'SEK' } })])] };
    expect(parseSearchResponse(raw, { maxPrice: 1000 }, 'EU').map((p) => p.id)).toEqual(['cheap']);
    expect(parseSearchResponse(raw, { maxPrice: 1000 }, 'SE').map((p) => p.id)).toEqual(['sek']);
    const eu = parseProduct(product('eu', [eurOffer(83)]), 'EU')!;
    expect(passesFilters(eu, { maxPrice: 1000 })).toBe(true);
    expect(passesFilters({ ...eu, region: undefined }, { maxPrice: 1000 })).toBe(false);
  });

  it('keeps second-hand first within the EU results', () => {
    const raw = { products: [product('new', [eurOffer(40)]), product('used', [eurOffer(30, { condition: 'used' })])] };
    expect(parseSearchResponse(raw, {}, 'EU').map((p) => p.id)).toEqual(['used', 'new']);
  });

  it('merges Swedish cards first, then EU cards, without duplicates, capped at the result limit', () => {
    const se = [card('a'), card('b')];
    const eu = [card('b', { region: 'EU' }), card('c', { region: 'EU' })];
    const merged = mergeRegions(se, eu);
    expect(merged.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1].region).toBeUndefined();
    const many = Array.from({ length: 20 }, (_, i) => card(`e${i}`, { region: 'EU' }));
    expect(mergeRegions(se, many)).toHaveLength(SHOP_RESULT_LIMIT);
    expect(mergeRegions([], [])).toEqual([]);
  });

  it('filters cached EU rows against the EUR cap and marks them EU', () => {
    const row = toExternalProductRow(parseProduct(product('eu', [eurOffer(70)]), 'EU')!);
    expect(fromExternalProductRow(row, { maxPrice: 1000 }, 'EU')).toMatchObject({ id: 'eu', region: 'EU', offer: null });
    expect(fromExternalProductRow(row, { maxPrice: 500 }, 'EU')).toBeNull();
    expect(fromExternalProductRow(row, { maxPrice: 1000 })).toBeNull();
    expect(fromExternalProductRow(row)).not.toHaveProperty('region');
  });
});
