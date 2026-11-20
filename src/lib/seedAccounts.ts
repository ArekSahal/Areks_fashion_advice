/**
 * Test accounts with a filled wardrobe (#35). Pure logic for scripts/seed/seed-test-accounts.ts, kept here so it is
 * unit tested. The script itself talks to Unsplash and Supabase.
 *
 * Photos come from a reviewed manifest (scripts/seed/photos.json), never from URLs typed by hand: the workflow's
 * `pick` mode fills a draft from the Unsplash API, an owner removes any photo that shows a face and fills in
 * `reviewed_by`, and only then will `seed` use it.
 */

export type Wardrobe = 'menswear' | 'womenswear' | 'both';

export type SeedAccount = {
  key: string;
  email: string;
  displayName: string;
  wardrobe: Wardrobe;
};

/** example.com is reserved (RFC 2606): nobody can own these inboxes. */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { key: 'test-1', email: 'cloey-test-1@example.com', displayName: 'Test User 1', wardrobe: 'menswear' },
  { key: 'test-2', email: 'cloey-test-2@example.com', displayName: 'Test User 2', wardrobe: 'womenswear' },
  { key: 'test-3', email: 'cloey-test-3@example.com', displayName: 'Test User 3', wardrobe: 'both' },
];

export const ITEMS_PER_ACCOUNT = 20;

/** Searches for the `pick` step. Flat lays and hangers, so photos rarely show a person at all. */
export const PICK_QUERIES: readonly { query: string; wardrobe: Exclude<Wardrobe, 'both'> | 'any' }[] = [
  { query: 'mens shirt flat lay', wardrobe: 'menswear' },
  { query: 'mens jacket on hanger', wardrobe: 'menswear' },
  { query: 'mens shoes product', wardrobe: 'menswear' },
  { query: 'chinos folded', wardrobe: 'menswear' },
  { query: 'dress on hanger', wardrobe: 'womenswear' },
  { query: 'skirt flat lay', wardrobe: 'womenswear' },
  { query: 'blouse on hanger', wardrobe: 'womenswear' },
  { query: 'heels product photo', wardrobe: 'womenswear' },
  { query: 'jeans folded', wardrobe: 'any' },
  { query: 't-shirt flat lay', wardrobe: 'any' },
  { query: 'sneakers product photo', wardrobe: 'any' },
  { query: 'knit sweater folded', wardrobe: 'any' },
  { query: 'coat on hanger', wardrobe: 'any' },
  { query: 'leather bag product', wardrobe: 'any' },
];

export const UNSPLASH_LICENCE = 'Unsplash License (https://unsplash.com/license)';

export type ManifestPhoto = {
  id: string;
  source: 'unsplash';
  url: string;
  page_url: string;
  download_location: string;
  photographer: string;
  photographer_url: string;
  licence: string;
  wardrobe: Exclude<Wardrobe, 'both'> | 'any';
  query: string;
};

export type Manifest = {
  version: 1;
  /** Who checked every photo for faces. Empty means not reviewed: seed refuses to run. */
  reviewed_by: string;
  photos: ManifestPhoto[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function httpsOn(value: unknown, host: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === host;
  } catch {
    return false;
  }
}

/** One Unsplash API photo (GET /search/photos → results[]) as a manifest row, or null if fields are missing. */
export function fromUnsplash(raw: unknown, wardrobe: ManifestPhoto['wardrobe'], query: string): ManifestPhoto | null {
  if (!isRecord(raw) || !isRecord(raw.urls) || !isRecord(raw.links) || !isRecord(raw.user)) return null;
  const userLinks = isRecord(raw.user.links) ? raw.user.links : {};
  const photo = {
    id: raw.id,
    source: 'unsplash' as const,
    url: raw.urls.regular,
    page_url: raw.links.html,
    download_location: raw.links.download_location,
    photographer: raw.user.name,
    photographer_url: userLinks.html,
    licence: UNSPLASH_LICENCE,
    wardrobe,
    query,
  };
  return validPhoto(photo) ? photo : null;
}

function validPhoto(p: Record<string, unknown>): p is ManifestPhoto {
  return (
    typeof p.id === 'string' &&
    /^[A-Za-z0-9_-]{1,40}$/.test(p.id) &&
    p.source === 'unsplash' &&
    httpsOn(p.url, 'images.unsplash.com') &&
    httpsOn(p.page_url, 'unsplash.com') &&
    httpsOn(p.download_location, 'api.unsplash.com') &&
    typeof p.photographer === 'string' &&
    p.photographer.length > 0 &&
    httpsOn(p.photographer_url, 'unsplash.com') &&
    p.licence === UNSPLASH_LICENCE &&
    (p.wardrobe === 'menswear' || p.wardrobe === 'womenswear' || p.wardrobe === 'any') &&
    typeof p.query === 'string'
  );
}

/** Drops duplicate photo ids, keeping the first. */
export function uniquePhotos(photos: readonly ManifestPhoto[]): ManifestPhoto[] {
  const seen = new Set<string>();
  return photos.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/** Validates scripts/seed/photos.json. Throws with a readable reason; seed must not run on a bad or unreviewed list. */
export function parseManifest(raw: unknown, { requireReview = true } = {}): Manifest {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.photos)) throw new Error('photos.json: expected { version: 1, photos: [...] }');
  const reviewedBy = typeof raw.reviewed_by === 'string' ? raw.reviewed_by.trim() : '';
  if (requireReview && !reviewedBy) {
    throw new Error('photos.json is not reviewed: check every photo for faces, remove any that show one, then fill in reviewed_by.');
  }
  const photos: ManifestPhoto[] = [];
  raw.photos.forEach((p, i) => {
    if (!isRecord(p) || !validPhoto(p)) throw new Error(`photos.json: photo ${i} is malformed`);
    photos.push(p);
  });
  return { version: 1, reviewed_by: reviewedBy, photos: uniquePhotos(photos) };
}

/**
 * The photos for one account: its own wardrobe plus 'any', up to `max`. The mixed account alternates menswear and
 * womenswear so it gets both. Accounts may share 'any' photos; each upload becomes its own item.
 */
export function photosForAccount(photos: readonly ManifestPhoto[], wardrobe: Wardrobe, max = ITEMS_PER_ACCOUNT): ManifestPhoto[] {
  if (wardrobe !== 'both') return photos.filter((p) => p.wardrobe === wardrobe || p.wardrobe === 'any').slice(0, max);
  const groups = [photos.filter((p) => p.wardrobe === 'menswear'), photos.filter((p) => p.wardrobe === 'womenswear'), photos.filter((p) => p.wardrobe === 'any')];
  const out: ManifestPhoto[] = [];
  for (let i = 0; out.length < max && groups.some((g) => i < g.length); i++) {
    for (const g of groups) {
      const p = g[i];
      if (p && out.length < max) out.push(p);
    }
  }
  return out;
}

/** The seed only ever deletes or resets accounts already marked as test accounts. */
export function assertTestAccount(email: string, profile: { is_test?: unknown } | null): void {
  if (profile?.is_test !== true) {
    throw new Error(`Refusing to touch ${email}: it exists but is not marked as a test account (profiles.is_test).`);
  }
}

/** Markdown for the workflow summary of `pick`: thumbnails to check for faces, with credits. */
export function reviewSummary(photos: readonly ManifestPhoto[]): string {
  const lines = [
    `## ${photos.length} candidate photos`,
    '',
    'Remove every photo that shows a face (even partly), then save the rest as `scripts/seed/photos.json` with `reviewed_by` filled in.',
    '',
    '| Photo | Id | Wardrobe | Credit |',
    '| --- | --- | --- | --- |',
  ];
  for (const p of photos) {
    const thumb = new URL(p.url);
    thumb.searchParams.set('w', '200');
    lines.push(`| <img src="${thumb.toString()}" width="120"> | \`${p.id}\` | ${p.wardrobe} | [${p.photographer.replace(/[|\]\[]/g, '')}](${p.page_url}) |`);
  }
  return lines.join('\n');
}
