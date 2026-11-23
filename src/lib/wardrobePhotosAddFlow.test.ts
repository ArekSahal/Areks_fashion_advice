import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedPhoto } from './photo';

// Minimal supabase stand-in: records uploads and Edge Function calls; each test sets the function reply.
// vi.mock is hoisted, but its factory only runs at the dynamic import below, after these are initialised.
const uploads: string[] = [];
const invoke = vi.fn();
/** Calls made by deleteWardrobePhoto, in order, and the replies the stand-in gives. */
const calls: string[] = [];
const replies = {
  row: { data: null as unknown, error: null as unknown },
  remove: { error: null as unknown },
  delete: { error: null as unknown },
};
vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          calls.push(`remove ${bucket} ${paths.join(',')}`);
          return replies.remove;
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            calls.push(`select ${table} ${id}`);
            return replies.row;
          },
        }),
      }),
      delete: () => ({
        eq: async (_col: string, id: string) => {
          calls.push(`delete ${table} ${id}`);
          return replies.delete;
        },
      }),
    }),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

const { addOutfitPhoto, deleteWardrobePhoto, detectGarments, saveGarment } = await import('./wardrobePhotos');

const USER = '11111111-2222-4333-8444-555555555555';
const PHOTO = '0b7c7c1e-8a52-4a3e-9d0e-1f2a3b4c5d6e';
const prepared: PreparedPhoto = {
  format: 'webp',
  faceCheck: 'blurred',
  clean: new ArrayBuffer(8),
  thumb: new ArrayBuffer(4),
  width: 1200,
  height: 1600,
};

/** An Edge Function error the way supabase-js returns it (FunctionsHttpError with the Response as context). */
function httpError(body: unknown) {
  return { data: null, error: { context: { json: async () => body } } };
}

beforeEach(() => {
  uploads.length = 0;
  invoke.mockReset();
});

describe('addOutfitPhoto', () => {
  it('uploads to quarantine and asks process-image for a wardrobe photo with the face check', async () => {
    invoke.mockResolvedValue({ data: { photo_id: PHOTO }, error: null });
    await expect(addOutfitPhoto(USER, prepared)).resolves.toBe(PHOTO);
    expect(uploads).toHaveLength(2);
    expect(uploads.every((p) => p.startsWith(`${USER}/`))).toBe(true);
    const [name, options] = invoke.mock.calls[0]!;
    expect(name).toBe('process-image');
    expect(options.body).toMatchObject({ target: 'wardrobe_photo', face_check: 'blurred', format: 'webp' });
  });

  it('throws when process-image fails, so the screen can offer a retry', async () => {
    invoke.mockResolvedValue(httpError({ error: 'processing_failed' }));
    await expect(addOutfitPhoto(USER, prepared)).rejects.toBeTruthy();
  });
});

describe('detectGarments', () => {
  it('returns the garments', async () => {
    invoke.mockResolvedValue({
      data: {
        status: 'detected',
        photo_id: PHOTO,
        garments: [{ box: { x: 0, y: 0, w: 0.5, h: 0.5 }, uncertain: false, tags: { subcategory: 'coat', colours: ['navy'] } }],
      },
      error: null,
    });
    const result = await detectGarments(PHOTO);
    expect(result).toEqual({ ok: true, garments: [expect.objectContaining({ index: 0, label: 'Navy coat' })] });
    expect(invoke).toHaveBeenCalledWith('detect-garments', { body: { photo_id: PHOTO } });
  });

  it('turns errors into kinds and never throws', async () => {
    invoke.mockResolvedValue(httpError({ error: 'needs_face_consent' }));
    await expect(detectGarments(PHOTO)).resolves.toEqual({ ok: false, kind: 'needs_face_consent' });
    invoke.mockResolvedValue({ data: { status: 'detected', photo_id: PHOTO, garments: [] }, error: null });
    // A "successful" reply without garments, or for another photo, is malformed: retryable, not "no clothes".
    await expect(detectGarments(PHOTO)).resolves.toEqual({ ok: false, kind: 'unavailable' });
    invoke.mockResolvedValue({
      data: { status: 'detected', photo_id: 'other', garments: [{ box: { x: 0, y: 0, w: 0.5, h: 0.5 }, tags: {} }] },
      error: null,
    });
    await expect(detectGarments(PHOTO)).resolves.toEqual({ ok: false, kind: 'unavailable' });
    invoke.mockResolvedValue(httpError({ error: 'not_garment' }));
    await expect(detectGarments(PHOTO)).resolves.toEqual({ ok: false, kind: 'no_garments' });
    invoke.mockRejectedValue(new Error('offline'));
    await expect(detectGarments(PHOTO)).resolves.toEqual({ ok: false, kind: 'unavailable' });
  });
});

describe('saveGarment', () => {
  it('sends only the photo id and garment index (the server uses its stored box and tags)', async () => {
    invoke.mockResolvedValue({ data: { item_id: 'item-1' }, error: null });
    await expect(saveGarment(USER, PHOTO, 2, prepared)).resolves.toBe('saved');
    const body = invoke.mock.calls[0]![1].body;
    expect(body.source).toEqual({ photo_id: PHOTO, garment_index: 2 });
    expect(body).not.toHaveProperty('target');
    expect(body).not.toHaveProperty('box');
    expect(body.face_check).toBe('blurred');
  });

  it('counts an already saved garment as done and other errors as failed', async () => {
    invoke.mockResolvedValue(httpError({ error: 'garment_already_saved' }));
    await expect(saveGarment(USER, PHOTO, 0, prepared)).resolves.toBe('already_saved');
    invoke.mockResolvedValue(httpError({ error: 'garment_not_found' }));
    await expect(saveGarment(USER, PHOTO, 0, prepared)).resolves.toBe('failed');
  });
});

describe('deleteWardrobePhoto', () => {
  beforeEach(() => {
    calls.length = 0;
    replies.row = { data: null, error: null };
    replies.remove = { error: null };
    replies.delete = { error: null };
  });

  it('removes the photo files, then the row', async () => {
    const clean = `${USER}/photos/${PHOTO}/clean.webp`;
    const thumb = `${USER}/photos/${PHOTO}/thumb.webp`;
    replies.row = { data: { id: PHOTO, image_path: clean, thumb_path: thumb }, error: null };
    await deleteWardrobePhoto(PHOTO);
    expect(calls).toEqual([
      `select wardrobe_photos ${PHOTO}`,
      `remove item-photos ${clean},${thumb}`,
      `delete wardrobe_photos ${PHOTO}`,
    ]);
  });

  it('does nothing when the photo is already gone (or not yours)', async () => {
    await deleteWardrobePhoto(PHOTO);
    expect(calls).toEqual([`select wardrobe_photos ${PHOTO}`]);
  });

  it('keeps the row when the files could not be removed, so a retry can find them', async () => {
    replies.row = { data: { id: PHOTO, image_path: 'a', thumb_path: null }, error: null };
    replies.remove = { error: new Error('offline') };
    await expect(deleteWardrobePhoto(PHOTO)).rejects.toThrow('offline');
    expect(calls).not.toContain(`delete wardrobe_photos ${PHOTO}`);
  });

  it('throws when the row delete fails', async () => {
    replies.row = { data: { id: PHOTO, image_path: 'a', thumb_path: 'b' }, error: null };
    replies.delete = { error: new Error('denied') };
    await expect(deleteWardrobePhoto(PHOTO)).rejects.toThrow('denied');
  });
});
