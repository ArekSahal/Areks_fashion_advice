import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SEED_ACCOUNTS,
  UNSPLASH_LICENCE,
  assertTestAccount,
  fromUnsplash,
  parseManifest,
  photosForAccount,
  reviewSummary,
  type ManifestPhoto,
} from './seedAccounts';

/** Shape of one result from Unsplash GET /search/photos (only the fields we read). */
function apiPhoto(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    urls: { regular: `https://images.unsplash.com/photo-${id}?ixid=abc&w=1080` },
    links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc` },
    user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane' } },
    ...overrides,
  };
}

function photo(id: string, wardrobe: ManifestPhoto['wardrobe']): ManifestPhoto {
  return fromUnsplash(apiPhoto(id), wardrobe, 'q')!;
}

describe('fromUnsplash', () => {
  it('maps an API result with credit and licence', () => {
    expect(fromUnsplash(apiPhoto('abc-123'), 'menswear', 'mens shirt')).toEqual({
      id: 'abc-123',
      source: 'unsplash',
      url: 'https://images.unsplash.com/photo-abc-123?ixid=abc&w=1080',
      page_url: 'https://unsplash.com/photos/abc-123',
      download_location: 'https://api.unsplash.com/photos/abc-123/download?ixid=abc',
      photographer: 'Jane Doe',
      photographer_url: 'https://unsplash.com/@jane',
      licence: UNSPLASH_LICENCE,
      wardrobe: 'menswear',
      query: 'mens shirt',
    });
  });

  it('rejects results missing fields or pointing at other hosts', () => {
    expect(fromUnsplash(null, 'any', 'q')).toBeNull();
    expect(fromUnsplash(apiPhoto('a', { user: { name: '' } }), 'any', 'q')).toBeNull();
    expect(fromUnsplash(apiPhoto('a', { urls: { regular: 'https://evil.example/x.jpg' } }), 'any', 'q')).toBeNull();
    expect(fromUnsplash(apiPhoto('a', { urls: { regular: 'http://images.unsplash.com/x' } }), 'any', 'q')).toBeNull();
    expect(fromUnsplash(apiPhoto('a/../b'), 'any', 'q')).toBeNull();
  });
});

describe('parseManifest', () => {
  const photos = [photo('a', 'menswear'), photo('b', 'any')];

  it('refuses an unreviewed list unless asked not to', () => {
    expect(() => parseManifest({ version: 1, reviewed_by: ' ', photos })).toThrow(/not reviewed/);
    expect(parseManifest({ version: 1, reviewed_by: '', photos }, { requireReview: false }).photos).toHaveLength(2);
  });

  it('accepts a reviewed list and drops duplicate ids', () => {
    const m = parseManifest({ version: 1, reviewed_by: 'Arek', photos: [...photos, photo('a', 'menswear')] });
    expect(m.reviewed_by).toBe('Arek');
    expect(m.photos.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('rejects malformed lists and photos', () => {
    expect(() => parseManifest({ version: 2, reviewed_by: 'Arek', photos })).toThrow();
    expect(() => parseManifest({ version: 1, reviewed_by: 'Arek', photos: [{ ...photos[0], url: 'https://x.test/a' }] })).toThrow(/photo 0/);
  });

  it('the committed photos.json is valid (reviewed or still empty)', () => {
    const raw = JSON.parse(readFileSync(new URL('../../scripts/seed/photos.json', import.meta.url), 'utf8'));
    const m = parseManifest(raw, { requireReview: raw.photos.length > 0 });
    expect(m.version).toBe(1);
  });
});

describe('photosForAccount', () => {
  const list = [photo('m1', 'menswear'), photo('m2', 'menswear'), photo('w1', 'womenswear'), photo('a1', 'any'), photo('a2', 'any')];

  it('gives each wardrobe its own photos plus the shared ones', () => {
    expect(photosForAccount(list, 'menswear').map((p) => p.id)).toEqual(['m1', 'm2', 'a1', 'a2']);
    expect(photosForAccount(list, 'womenswear').map((p) => p.id)).toEqual(['w1', 'a1', 'a2']);
  });

  it('mixes menswear and womenswear for the mixed account and respects the cap', () => {
    expect(photosForAccount(list, 'both').map((p) => p.id)).toEqual(['m1', 'w1', 'a1', 'm2', 'a2']);
    expect(photosForAccount(list, 'both', 3).map((p) => p.id)).toEqual(['m1', 'w1', 'a1']);
  });
});

describe('accounts', () => {
  it('uses reserved example.com addresses and one account per wardrobe', () => {
    expect(SEED_ACCOUNTS.every((a) => a.email.endsWith('@example.com'))).toBe(true);
    expect(SEED_ACCOUNTS.map((a) => a.wardrobe)).toEqual(['menswear', 'womenswear', 'both']);
  });

  it('refuses accounts not marked as test accounts', () => {
    expect(() => assertTestAccount('x@example.com', null)).toThrow(/Refusing/);
    expect(() => assertTestAccount('x@example.com', { is_test: false })).toThrow(/Refusing/);
    expect(() => assertTestAccount('x@example.com', { is_test: 'true' })).toThrow(/Refusing/);
    expect(() => assertTestAccount('x@example.com', { is_test: true })).not.toThrow();
  });
});

describe('reviewSummary', () => {
  it('lists every photo with a small thumbnail and credit', () => {
    const md = reviewSummary([photo('a', 'menswear')]);
    expect(md).toContain('1 candidate photos');
    expect(md).toContain('w=200');
    expect(md).not.toContain('w=1080');
    expect(md).toContain('[Jane Doe](https://unsplash.com/photos/a)');
  });
});
