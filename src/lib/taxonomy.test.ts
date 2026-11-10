import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  COLOURS,
  categoryOf,
  canPair,
  colourRelation,
  colourScore,
  itemColourScore,
  formalityScore,
  patternScore,
  seasonOverlap,
} from './taxonomy';

describe('taxonomy', () => {
  it('has no subcategory in two categories', () => {
    const all = Object.values(CATEGORIES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('maps subcategories back to their category', () => {
    expect(categoryOf('blazer')).toBe('outerwear');
    expect(categoryOf('loafers')).toBe('footwear');
  });

  it('uses valid hex values and hues', () => {
    for (const c of Object.values(COLOURS)) {
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
      if (c.hue !== null) expect(c.hue).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('colour harmony', () => {
  it('treats neutrals as matching everything', () => {
    expect(colourRelation('navy', 'red')).toBe('neutral');
    expect(colourScore('camel', 'purple')).toBe(1);
  });

  it('recognises classic pairs on the painter\'s wheel', () => {
    expect(colourRelation('red', 'green')).toBe('complementary');
    expect(colourRelation('blue', 'orange')).toBe('complementary');
    expect(colourRelation('yellow', 'purple')).toBe('complementary');
    expect(colourRelation('blue', 'purple')).toBe('analogous');
    expect(colourRelation('light_blue', 'lavender')).toBe('analogous');
    expect(colourRelation('pink', 'burgundy')).toBe('monochrome');
  });

  it('wraps around the colour wheel', () => {
    // 0° and 350° are 10° apart, not 350°.
    expect(colourRelation('red', 'burgundy')).toBe('monochrome');
  });

  it('lets pastels sit together', () => {
    expect(colourRelation('pink', 'lavender')).toBe('tonal');
  });

  it('scores in-between hues lowest', () => {
    expect(colourRelation('yellow', 'teal')).toBe('contrast');
    expect(colourScore('yellow', 'teal')).toBeLessThan(colourScore('green', 'mint'));
  });

  it('weights the dominant colour, so a neutral detail does not rescue a clash', () => {
    expect(itemColourScore(['orange', 'black'], ['green'])).toBeLessThan(0.7);
    expect(itemColourScore(['navy'], ['red'])).toBe(1);
  });
});

describe('pairwise rules', () => {
  it('allows layering but not two items in the same slot', () => {
    expect(canPair('shirt', 'knit')).toBe(true);
    expect(canPair('knit', 'coat')).toBe(true);
    expect(canPair('shirt', 't_shirt')).toBe(false);
    expect(canPair('coat', 'parka')).toBe(false);
    expect(canPair('jeans', 'chinos')).toBe(false);
    expect(canPair('dress', 'cardigan')).toBe(true);
    expect(canPair('dress', 'jeans')).toBe(false);
    expect(canPair('belt', 'watch')).toBe(true);
    expect(canPair('jeans', 'sneakers')).toBe(true);
  });

  it('penalises big formality gaps', () => {
    expect(formalityScore(3, 3)).toBe(1);
    expect(formalityScore(4, 2)).toBeGreaterThan(formalityScore(5, 1));
  });

  it('lets one print sit with quiet pieces', () => {
    expect(patternScore('floral', 'solid')).toBe(1);
    expect(patternScore('floral', 'animal')).toBeLessThan(0.5);
  });

  it('treats untagged seasons as all-season', () => {
    expect(seasonOverlap([], ['winter'])).toBe(true);
    expect(seasonOverlap(['summer'], ['winter'])).toBe(false);
  });
});
