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

/** English words for each subcategory. Regex sources, matched whole-word and case-insensitive. */
const SUBCATEGORY_WORDS: Record<Subcategory, string[]> = {
  t_shirt: ['t-?shirts?', 'tees?'],
  shirt: ['shirts?'],
  blouse: ['blouses?'],
  polo: ['polos?', 'polo shirts?'],
  knit: ['knits?', 'knitwear', 'sweaters?', 'jumpers?', 'pullovers?'],
  sweatshirt: ['sweatshirts?'],
  hoodie: ['hoodies?', 'hooded sweatshirts?'],
  tank_top: ['tank tops?', 'tanks?', 'camis?', 'camisoles?', 'vest tops?'],
  cardigan: ['cardigans?'],
  jeans: ['jeans'],
  trousers: ['trousers', 'pants', 'slacks'],
  chinos: ['chinos?'],
  shorts: ['shorts'],
  skirt: ['skirts?'],
  joggers: ['joggers', 'sweatpants', 'track ?pants'],
  leggings: ['leggings'],
  dress: ['dress', 'dresses'],
  jumpsuit: ['jumpsuits?', 'playsuits?', 'dungarees', 'overalls'],
  coat: ['coats?', 'overcoats?', 'trench ?coats?', 'trenches'],
  jacket: ['jackets?', 'bombers?'],
  blazer: ['blazers?', 'sport ?coats?', 'suit jackets?'],
  parka: ['parkas?'],
  gilet: ['gilets?', 'body ?warmers?', 'puffer vests?'],
  raincoat: ['raincoats?', 'rain ?jackets?', 'rain coats?'],
  overshirt: ['overshirts?', 'shackets?', 'shirt jackets?'],
  sneakers: ['sneakers?', 'trainers?'],
  boots: ['boots?'],
  loafers: ['loafers?'],
  derbies: ['derbys?', 'derbies', 'oxfords?', 'brogues?'],
  heels: ['heels', 'pumps', 'stilettos?'],
  flats: ['flats', 'ballet flats?', 'ballerinas?'],
  sandals: ['sandals?'],
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

/** English colour words. Multi-word names come first so "light blue" isn't also read as "blue". */
const COLOUR_WORDS: Record<Colour, string[]> = {
  off_white: ['off[- ]?white', 'cream', 'ecru', 'ivory'],
  light_blue: ['light blue', 'sky blue', 'pale blue', 'baby blue'],
  forest_green: ['forest green', 'bottle green', 'dark green'],
  denim_blue: ['denim blue', 'mid blue', 'indigo'],
  navy: ['navy blue', 'navy', 'dark blue'],
  black: ['black'],
  white: ['white'],
  grey: ['grey', 'gray'],
  charcoal: ['charcoal', 'anthracite'],
  silver: ['silver'],
  gold: ['gold'],
  beige: ['beige', 'sand', 'stone', 'oatmeal'],
  camel: ['camel', 'tan'],
  brown: ['brown', 'chocolate', 'cognac'],
  olive: ['olive', 'khaki'],
  red: ['red'],
  burgundy: ['burgundy', 'bordeaux', 'maroon', 'wine'],
  pink: ['pink', 'rose'],
  orange: ['orange'],
  rust: ['rust', 'terracotta'],
  yellow: ['yellow'],
  mustard: ['mustard'],
  green: ['green'],
  mint: ['mint'],
  teal: ['teal'],
  blue: ['blue', 'cobalt'],
  purple: ['purple'],
  lavender: ['lavender', 'lilac'],
};

type Rule<T> = { value: T; re: RegExp };

function rules<T extends string>(table: Record<T, string[]>): Rule<T>[] {
  return (Object.entries(table) as [T, string[]][]).flatMap(([value, words]) =>
    words.map((w) => ({ value, re: new RegExp(`(?<![a-z])${w}(?![a-z])`, 'gi') })),
  );
}

const SUBCATEGORY_RULES = rules(SUBCATEGORY_WORDS);
const COLOUR_RULES = rules(COLOUR_WORDS);

/**
 * The garment type named in a product title. English puts the garment noun last ("shirt dress" is a dress,
 * "dress shirt" is a shirt, "denim jacket" is a jacket), so the match that ends last wins; on a tie, the longest
 * ("polo shirt" over "shirt"). null if no garment word is found.
 */
export function subcategoryFromText(text: string): Subcategory | null {
  let best: { value: Subcategory; end: number; len: number } | null = null;
  for (const { value, re } of SUBCATEGORY_RULES) {
    for (const m of text.matchAll(re)) {
      const end = (m.index ?? 0) + m[0].length;
      if (!best || end > best.end || (end === best.end && m[0].length > best.len)) {
        best = { value, end, len: m[0].length };
      }
    }
  }
  return best?.value ?? null;
}

/** Colours named in a title, in our palette ids. Overlapping names count once ("navy blue" → navy, not blue). */
export function coloursFromText(text: string): Colour[] {
  const taken: [number, number][] = [];
  const found: Colour[] = [];
  for (const { value, re } of COLOUR_RULES) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      if (!found.includes(value)) found.push(value);
    }
  }
  return found;
}

export type ProductTags = { category: Category | null; subcategory: Subcategory | null; colours: Colour[] };

/**
 * Our best reading of a Shop product's type and colour: the title first, then the Channel3 category slug. If the user
 * searched with a category filter and the title says something else, we trust the filter for the category and drop
 * the subcategory.
 */
export function inferProductTags(
  product: { title: string; categorySlug: string | null },
  searchedCategory: Category | null = null,
): ProductTags {
  const slugText = product.categorySlug?.replace(/[/_>-]+/g, ' ') ?? '';
  let subcategory = subcategoryFromText(product.title) ?? (slugText ? subcategoryFromText(slugText) : null);
  let category = subcategory ? categoryOf(subcategory) : null;
  if (searchedCategory && category !== searchedCategory) {
    category = searchedCategory;
    subcategory = null;
  }
  return { category, subcategory, colours: coloursFromText(product.title) };
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
 * and, when the title names a colour, at least one shared colour. Needs a subcategory or a colour on top of the
 * category, so a vague product ("Tops") never claims you own something like it.
 * Pass only items whose tags the user confirmed.
 */
export function ownedSimilar(tags: ProductTags, items: readonly OwnedItemTags[]): OwnedItemTags[] {
  if (!tags.category) return [];
  if (!tags.subcategory && tags.colours.length === 0) return [];
  return items.filter((item) => {
    if (item.category !== tags.category) return false;
    if (tags.subcategory && item.subcategory !== tags.subcategory) return false;
    if (tags.colours.length > 0 && !(item.colours ?? []).some((c) => (tags.colours as string[]).includes(c))) return false;
    return true;
  });
}

/** Card copy, or null when there's nothing to say. */
export function ownedSimilarLabel(count: number): string | null {
  return count > 0 ? `You own ${count} like this` : null;
}
