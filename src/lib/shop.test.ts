import { describe, expect, it } from 'vitest';
import {
  SHOP_RESULT_LIMIT,
  ShopInputError,
  buildChannel3Search,
  filterAndRank,
  formatPrice,
  fromExternalProductRow,
  normalizeSearchInput,
  parseProduct,
  parseSearchResponse,
  pickBestOffer,
  searchCacheMaterial,
  toExternalProductRow,
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
