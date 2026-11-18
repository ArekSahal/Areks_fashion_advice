/**
 * M1.5 Shop (#34): "You own N like this" on Shop cards, so the shop doesn't push buying something the user already has
 * (docs/channel3.md → owned first). Pure TypeScript: no network, no AI, no Channel3 credits.
 *
 * A Channel3 product has no tags in our taxonomy, so we read the garment type and colours from its title (English, see
 * SHOP_LOCALE) with a small keyword list, falling back to the Channel3 category slug and the category filter the user
 * searched with. Then we count the user's confirmed items of the same type that share a colour.
 *
 * This is a deliberately simple rule (category/colour, no embeddings). The matching engine (M3) replaces it.
 */
import { categoryOf, type Category, type Colour, type Subcategory } from './taxonomy';

/**
 * English words for each subcategory. Regex sources, matched whole-word and case-insensitive. Compounds like
 * "chino pants" are listed so the garment, not the generic noun, wins the "last word" rule below.
 */
const SUBCATEGORY_WORDS: Record<Subcategory, string[]> = {
  t_shirt: ['t-?shirts?', 'tee[- ]?shirts?', 'tees?'],
  shirt: ['shirts?'],
  blouse: ['blouses?'],
  polo: ['polos?', 'polo shirts?'],
  knit: ['knits?', 'knitwear', 'sweaters?', 'jumpers?', 'pullovers?'],
  sweatshirt: ['sweatshirts?'],
  hoodie: ['hoodies?', 'hooded sweatshirts?'],
  tank_top: ['tank tops?', 'tanks?', 'camis?', 'camisoles?', 'vest tops?'],
  cardigan: ['cardigans?', 'cardigan sweaters?'],
  jeans: ['jeans?'],
  trousers: ['trousers?', 'pants?', 'slacks'],
  chinos: ['chinos?', 'chinos? (?:pants|trousers)'],
  shorts: ['shorts'],
  skirt: ['skirts?'],
  joggers: ['joggers?', 'jogger (?:pants|trousers)', 'sweatpants', 'track ?pants'],
  leggings: ['leggings?'],
  dress: ['dress', 'dresses', 'gowns?'],
  jumpsuit: ['jumpsuits?', 'playsuits?', 'rompers?', 'dungarees', 'overalls'],
  coat: ['coats?', 'overcoats?', 'trench ?coats?', 'trenches', 'peacoats?'],
  jacket: ['jackets?', 'bombers?', 'puffers?', 'puffer jackets?', 'windbreakers?', 'anoraks?'],
  blazer: ['blazers?', 'blazer jackets?', 'sport ?coats?', 'suit jackets?'],
  parka: ['parkas?', 'parka (?:jackets?|coats?)'],
  gilet: ['gilets?', 'body ?warmers?', 'puffer vests?'],
  raincoat: ['raincoats?', 'rain ?jackets?', 'rain coats?'],
  overshirt: ['overshirts?', 'shackets?', 'shirt jackets?'],
  sneakers: ['sneakers?', 'trainers?'],
  boots: ['boots?', 'booties'],
  loafers: ['loafers?'],
  derbies: ['derbys?', 'derbies', 'oxfords?', 'brogues?'],
  heels: ['heels', 'pumps', 'stilettos?'],
  flats: ['flats', 'ballet flats?', 'ballerinas?'],
  sandals: ['sandals?', 'slides', 'flip[- ]?flops'],
  bag: ['bags?', 'handbags?', 'totes?', 'backpacks?', 'clutch', 'clutches'],
  belt: ['belts?'],
  scarf: ['scarf', 'scarves'],
  hat: ['hats?', 'beanies?'],
  cap: ['caps?'],
  sunglasses: ['sunglasses'],
  jewellery: ['jewellery', 'jewelry', 'necklaces?', 'earrings?', 'bracelets?', 'rings?'],
  watch: ['watch', 'watches'],
  tie: ['ties?', 'bow ?ties?'],
  gloves: ['gloves', 'mittens'],
};

/**
 * Garment nouns outside our taxonomy (or too generic to place). They take part in the "last word" rule but give no
 * subcategory, so "Tie-front top" and "Cap sleeve top" aren't read as a tie or a cap.
 */
const GENERIC_HEADS = ['tops?', 'shoes?', 'socks?', 'bodysuits?', 'sets?', 'swimsuits?', 'bikinis?', 'wallets?', 'mules?'];

/** English colour words. The longest name wins where names overlap ("mint green" → mint, not green). */
const COLOUR_WORDS: Record<Colour, string[]> = {
  off_white: ['off[- ]?white', 'cream', 'ecru', 'ivory'],
  light_blue: ['light blue', 'sky blue', 'pale blue', 'baby blue'],
  forest_green: ['forest green', 'bottle green', 'dark green'],
  denim_blue: ['denim blue', 'mid blue', 'indigo'],
  navy: ['navy blue', 'navy', 'dark blue'],
  black: ['black'],
  white: ['white'],
  grey: ['grey', 'gray'],
  charcoal: ['charcoal', 'charcoal gr[ae]y', 'anthracite'],
  silver: ['silver'],
  gold: ['gold'],
  beige: ['beige', 'sand', 'stone', 'oatmeal'],
  camel: ['camel', 'tan'],
  brown: ['brown', 'chocolate', 'cognac'],
  olive: ['olive', 'olive green', 'army green'],
  red: ['red'],
  burgundy: ['burgundy', 'burgundy red', 'bordeaux', 'maroon', 'wine', 'wine red'],
  pink: ['pink', 'rose pink', 'dusty rose'],
  orange: ['orange'],
  rust: ['rust', 'terracotta'],
  yellow: ['yellow'],
  mustard: ['mustard', 'mustard yellow'],
  green: ['green'],
  mint: ['mint', 'mint green'],
  teal: ['teal'],
  blue: ['blue', 'cobalt'],
  purple: ['purple'],
  lavender: ['lavender', 'lilac'],
};

/** Colours a stylist treats as the same when saying "you own one like this". */
const SAME_COLOUR: Partial<Record<Colour, Colour[]>> = {
  white: ['off_white'],
  off_white: ['white'],
  grey: ['charcoal'],
  charcoal: ['grey'],
};

type Rule<T> = { value: T; re: RegExp };
type Match<T> = { value: T; start: number; end: number };

function rules<T>(entries: [T, string[]][]): Rule<T>[] {
  return entries.flatMap(([value, words]) =>
    words.map((w) => ({ value, re: new RegExp(`(?<![a-z])${w}(?![a-z])`, 'gi') })),
  );
}

function matches<T>(text: string, list: Rule<T>[]): Match<T>[] {
  const out: Match<T>[] = [];
  for (const { value, re } of list) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      out.push({ value, start, end: start + m[0].length });
    }
  }
  return out;
}

const SUBCATEGORY_RULES = rules<Subcategory | null>([
  ...(Object.entries(SUBCATEGORY_WORDS) as [Subcategory, string[]][]),
  [null, GENERIC_HEADS],
]);
const COLOUR_RULES = rules(Object.entries(COLOUR_WORDS) as [Colour, string[]][]);

/**
 * The garment type named in a product title. English puts the garment noun last ("shirt dress" is a dress,
 * "dress shirt" is a shirt, "denim jacket" is a jacket), so the match that ends last wins; on a tie, the longest
 * ("polo shirt" over "shirt"). null if no garment word is found or the last one is outside our taxonomy.
 */
export function subcategoryFromText(text: string): Subcategory | null {
  let best: Match<Subcategory | null> | null = null;
  for (const m of matches(text, SUBCATEGORY_RULES)) {
    if (!best || m.end > best.end || (m.end === best.end && m.end - m.start > best.end - best.start)) best = m;
  }
  return best?.value ?? null;
}

/** Colours named in a title, in our palette ids. Overlapping names count once, longest first. */
export function coloursFromText(text: string): Colour[] {
  const all = matches(text, COLOUR_RULES).sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken: Match<Colour>[] = [];
  for (const m of all) {
    if (!taken.some((t) => m.start < t.end && m.end > t.start)) taken.push(m);
  }
  const found: Colour[] = [];
  for (const m of taken.sort((a, b) => a.start - b.start)) if (!found.includes(m.value)) found.push(m.value);
  return found;
}

/** The title without the brand name, so "Stone Island", "Off-White" or "Polo Ralph Lauren" aren't read as tags. */
export function stripBrand(title: string, brand: string | null): string {
  const b = brand?.trim();
  if (!b) return title;
  return title.split(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' ');
}

export type ProductTags = { category: Category | null; subcategory: Subcategory | null; colours: Colour[] };

/**
 * Our best reading of a Shop product's type and colour: the title (without the brand) first, then the Channel3
 * category slug. If the user searched with a category filter and the title says something else, we trust the filter
 * for the category and drop the subcategory.
 */
export function inferProductTags(
  product: { title: string; brand?: string | null; categorySlug: string | null },
  searchedCategory: Category | null = null,
): ProductTags {
  const title = stripBrand(product.title, product.brand ?? null);
  const slugText = product.categorySlug?.replace(/[/_>-]+/g, ' ') ?? '';
  let subcategory = subcategoryFromText(title) ?? (slugText ? subcategoryFromText(slugText) : null);
  let category = subcategory ? categoryOf(subcategory) : null;
  if (searchedCategory && category !== searchedCategory) {
    category = searchedCategory;
    subcategory = null;
  }
  return { category, subcategory, colours: coloursFromText(title) };
}

/** The tag columns of a wardrobe item that this rule needs. */
export type OwnedItemTags = {
  id: string;
  category: string | null;
  subcategory: string | null;
  colours: readonly string[] | null;
};

/**
 * The user's items that look like this product: same subcategory (or same category when the subcategory is unknown)
 * and at least one shared colour (white/off-white and grey/charcoal count as the same). The title must name a
 * colour: "Floral midi dress" never claims you own one like it just because you own a dress.
 * Pass only items the user still owns and whose tags they confirmed.
 */
export function ownedSimilar(tags: ProductTags, items: readonly OwnedItemTags[]): OwnedItemTags[] {
  if (!tags.category || tags.colours.length === 0) return [];
  const wanted = new Set<string>(tags.colours.flatMap((c) => [c, ...(SAME_COLOUR[c] ?? [])]));
  return items.filter((item) => {
    if (item.category !== tags.category) return false;
    if (tags.subcategory && item.subcategory !== tags.subcategory) return false;
    return (item.colours ?? []).some((c) => wanted.has(c));
  });
}

/** Card copy, or null when there's nothing to say. Large counts are capped so the line stays short. */
export function ownedSimilarLabel(count: number): string | null {
  if (count <= 0) return null;
  return `You own ${count > 9 ? '9+' : count} like this`;
}
