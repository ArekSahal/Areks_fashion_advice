import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  COLOURS,
  categoryOf,
  colourRelation,
  colourScore,
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

  it('recognises classic relations', () => {
    expect(colourRelation('red', 'burgundy')).toBe('analogous');
    expect(colourRelation('blue', 'orange')).toBe('complementary');
    expect(colourRelation('pink', 'burgundy')).toBe('monochrome');
  });

  it('wraps around the colour wheel', () => {
    // 5° and 340° are 25° apart, not 335°.
    expect(colourRelation('red', 'burgundy')).not.toBe('complementary');
  });

  it('scores clashes lowest', () => {
    expect(colourScore('green', 'purple')).toBeLessThan(colourScore('green', 'mint'));
  });
});

describe('pairwise rules', () => {
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
