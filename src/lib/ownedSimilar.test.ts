import { describe, expect, it } from 'vitest';
import {
  coloursFromText,
  inferProductTags,
  ownedSimilar,
  ownedSimilarLabel,
  subcategoryFromText,
  type OwnedItemTags,
} from './ownedSimilar';

describe('subcategoryFromText', () => {
  it.each([
    ['Organic cotton T-shirt', 't_shirt'],
    ['Relaxed tee in white', 't_shirt'],
    ['Oxford shirt', 'shirt'],
    ['Classic piqué polo shirt', 'polo'],
    ['Loopback sweatshirt', 'sweatshirt'],
    ['Hooded sweatshirt', 'hoodie'],
    ['Linen overshirt', 'overshirt'],
    ['Shirt dress in poplin', 'dress'],
    ['Slim dress shirt', 'shirt'],
    ['Denim jacket', 'jacket'],
    ['Wool trench coat', 'coat'],
    ['Waterproof rain jacket', 'raincoat'],
    ['Single-breasted blazer', 'blazer'],
    ['Straight leg jeans', 'jeans'],
    ['Wide trousers', 'trousers'],
    ['Cargo pants', 'trousers'],
    ['Fleece track pants', 'joggers'],
    ['Leather Chelsea boots', 'boots'],
    ['Low-top trainers', 'sneakers'],
    ['Ribbed tank top', 'tank_top'],
    ['Merino wool sweater', 'knit'],
    ['Leather tote', 'bag'],
    ['Gold hoop earrings', 'jewellery'],
  ])('%s → %s', (title, expected) => {
    expect(subcategoryFromText(title)).toBe(expected);
  });

  it('ignores garment words inside other words', () => {
    expect(subcategoryFromText('Tankini')).toBeNull();
    expect(subcategoryFromText('Capsule collection')).toBeNull();
    expect(subcategoryFromText('Gift card')).toBeNull();
  });
});

describe('coloursFromText', () => {
  it('maps synonyms to palette ids', () => {
    expect(coloursFromText('Gray wool coat')).toEqual(['grey']);
    expect(coloursFromText('Cream knit')).toEqual(['off_white']);
    expect(coloursFromText('Khaki chinos')).toEqual(['olive']);
  });

  it('reads multi-word colours once', () => {
    expect(coloursFromText('Navy blue blazer')).toEqual(['navy']);
    expect(coloursFromText('Light blue shirt')).toEqual(['light_blue']);
    expect(coloursFromText('Off-white sneakers')).toEqual(['off_white']);
  });

  it('finds several colours and skips words that only contain one', () => {
    expect(coloursFromText('Black and white striped tee').sort()).toEqual(['black', 'white']);
    expect(coloursFromText('Ribbed tank top')).toEqual([]);
    expect(coloursFromText('Redwood loafers')).toEqual([]);
  });
});

describe('inferProductTags', () => {
  it('uses the title first', () => {
    expect(inferProductTags({ title: 'Black leather jacket', categorySlug: null })).toEqual({
      category: 'outerwear',
      subcategory: 'jacket',
      colours: ['black'],
    });
  });

  it('falls back to the Channel3 category slug', () => {
    expect(inferProductTags({ title: 'The Everyday 501', categorySlug: 'clothing/pants/jeans' })).toMatchObject({
      category: 'bottom',
      subcategory: 'jeans',
    });
  });

  it('trusts the searched category over a title that disagrees', () => {
    expect(inferProductTags({ title: 'Shirt jacket', categorySlug: null }, 'top')).toMatchObject({
      category: 'top',
      subcategory: null,
    });
    expect(inferProductTags({ title: 'Navy knit', categorySlug: null }, 'top')).toMatchObject({
      category: 'top',
      subcategory: 'knit',
    });
  });

  it('knows nothing about a title without garment words', () => {
    expect(inferProductTags({ title: 'The Essential', categorySlug: null })).toEqual({
      category: null,
      subcategory: null,
      colours: [],
    });
  });
});

const wardrobe: OwnedItemTags[] = [
  { id: 'a', category: 'bottom', subcategory: 'jeans', colours: ['denim_blue'] },
  { id: 'b', category: 'bottom', subcategory: 'jeans', colours: ['black'] },
  { id: 'c', category: 'top', subcategory: 't_shirt', colours: ['white', 'navy'] },
  { id: 'd', category: 'top', subcategory: 'knit', colours: ['grey'] },
  { id: 'e', category: 'outerwear', subcategory: 'coat', colours: null },
];

const ids = (items: OwnedItemTags[]) => items.map((i) => i.id);

describe('ownedSimilar', () => {
  it('matches the same subcategory and a shared colour', () => {
    expect(ids(ownedSimilar(inferProductTags({ title: 'Black slim jeans', categorySlug: null }), wardrobe))).toEqual(['b']);
    expect(ids(ownedSimilar(inferProductTags({ title: 'White tee', categorySlug: null }), wardrobe))).toEqual(['c']);
  });

  it('matches every item of the subcategory when the title names no colour', () => {
    expect(ids(ownedSimilar(inferProductTags({ title: 'Straight jeans', categorySlug: null }), wardrobe))).toEqual([
      'a',
      'b',
    ]);
  });

  it('matches by category + colour when only the category filter is known', () => {
    expect(ids(ownedSimilar(inferProductTags({ title: 'Grey essential', categorySlug: null }, 'top'), wardrobe))).toEqual([
      'd',
    ]);
  });

  it('never claims a match from a category alone', () => {
    expect(ownedSimilar(inferProductTags({ title: 'The Essential', categorySlug: null }, 'top'), wardrobe)).toEqual([]);
  });

  it('needs a shared colour when the title names one', () => {
    expect(ownedSimilar(inferProductTags({ title: 'Red knit', categorySlug: null }), wardrobe)).toEqual([]);
    expect(ownedSimilar(inferProductTags({ title: 'Camel coat', categorySlug: null }), wardrobe)).toEqual([]);
  });

  it('handles an empty wardrobe', () => {
    expect(ownedSimilar(inferProductTags({ title: 'Black jeans', categorySlug: null }), [])).toEqual([]);
  });
});

describe('ownedSimilarLabel', () => {
  it('says nothing for zero', () => {
    expect(ownedSimilarLabel(0)).toBeNull();
    expect(ownedSimilarLabel(1)).toBe('You own 1 like this');
    expect(ownedSimilarLabel(3)).toBe('You own 3 like this');
  });
});
