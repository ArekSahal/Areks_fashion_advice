import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

const { countByPhoto, itemCountLabel } = await import('./wardrobePhotos');

describe('countByPhoto', () => {
  it('counts items per source photo and skips unlinked items', () => {
    expect(
      countByPhoto([{ source_photo_id: 'a' }, { source_photo_id: 'b' }, { source_photo_id: 'a' }, { source_photo_id: null }]),
    ).toEqual({ a: 2, b: 1 });
  });
});

describe('itemCountLabel', () => {
  it('reads naturally', () => {
    expect(itemCountLabel(0)).toBe('No items yet');
    expect(itemCountLabel(1)).toBe('1 item');
    expect(itemCountLabel(4)).toBe('4 items');
  });
});
