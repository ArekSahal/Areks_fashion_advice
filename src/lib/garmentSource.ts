/**
 * #36 slice 3: what the server keeps from a detection, and how it turns one detected garment into a new item.
 *
 * detect-garments stores its result on `wardrobe_photos.detections` (server-only column). When the app saves the
 * garments the user ticked, it uploads one cropped photo per garment through process-image with
 * `{ source: { photo_id, garment_index } }`. process-image then looks the garment up here, so the item's box and
 * suggested tags come from what the server stored, never from values the app sends (Platform review, #51).
 *
 * Pure TypeScript: runs in Deno (Edge Functions import it with the `.ts` path), in the app and in Vitest.
 */
import { type DetectedGarment, DETECTION_SCHEMA_VERSION, MAX_GARMENTS, isValidSourceBox } from './detection.ts';
import { TAG_FIELDS, TAGGING_SCHEMA_VERSION, type ItemTags } from './tagging.ts';


/** Everything detect-garments returned for one garment, so a repeat call can answer from the stored copy. */
export type StoredGarment = DetectedGarment;

export interface StoredDetections {
  schema_version: number;
  model: string;
  garments: StoredGarment[];
}

/** The jsonb written to wardrobe_photos.detections after a successful detection. */
export function toStoredDetections(garments: readonly DetectedGarment[], model: string): StoredDetections {
  return {
    schema_version: DETECTION_SCHEMA_VERSION,
    model,
    garments: garments.slice(0, MAX_GARMENTS).map((g) => ({
      box: g.box,
      tags: g.tags,
      confidence: g.confidence,
      needsCheck: g.needsCheck,
      warnings: g.warnings,
      detectionConfidence: g.detectionConfidence,
      uncertain: g.uncertain,
    })),
  };
}

/** The stored garments, if `detections` is a usable stored result (same schema version); otherwise null. */
export function storedGarments(detections: unknown): StoredGarment[] | null {
  if (!isRecord(detections) || detections.schema_version !== DETECTION_SCHEMA_VERSION) return null;
  if (!Array.isArray(detections.garments) || detections.garments.length === 0) return null;
  const ok = detections.garments.every((g) => isRecord(g) && isValidSourceBox(g.box) && isRecord(g.tags));
  return ok ? (detections.garments as StoredGarment[]) : null;
}

/** detect-garments' reply shape for each garment (snake_case), shared by fresh and stored results. */
export function garmentsForResponse(garments: readonly StoredGarment[]) {
  return garments.map((g) => ({
    box: g.box,
    detection_confidence: g.detectionConfidence ?? null,
    uncertain: g.uncertain === true,
    tags: g.tags,
    confidence: g.confidence ?? {},
    needs_check: g.needsCheck ?? [],
    warnings: g.warnings ?? [],
  }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates the `source` field of a process-image request. Null when absent or malformed. */
export function parseGarmentSource(raw: unknown): { photoId: string; garmentIndex: number } | null {
  if (!isRecord(raw)) return null;
  const photoId = raw.photo_id;
  const index = raw.garment_index;
  if (typeof photoId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId)) {
    return null;
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_GARMENTS) return null;
  return { photoId, garmentIndex: index };
}

/**
 * The clothing_items columns for garment `index` of a stored detection: the link to the photo, its box and the
 * suggested tags (in the same tag_confidence shape tag-item writes, so the confirm-tags screen reuses them without
 * another AI call). Tags stay unconfirmed: tags_confirmed_at is not set. Null if there is no such valid garment.
 */
export function itemColumnsFromDetection(detections: unknown, index: number, photoId: string) {
  if (!isRecord(detections) || !Array.isArray(detections.garments)) return null;
  const g = detections.garments[index];
  if (!isRecord(g) || !isValidSourceBox(g.box) || !isRecord(g.tags)) return null;
  // Only the known tag columns, so nothing else in the stored object can reach the insert.
  const stored = g.tags;
  const tags = Object.fromEntries(TAG_FIELDS.filter((f) => f in stored).map((f) => [f, stored[f]])) as Partial<ItemTags>;
  return {
    ...tags,
    source_photo_id: photoId,
    source_box: g.box,
    tag_confidence: {
      schema_version: TAGGING_SCHEMA_VERSION,
      model: typeof detections.model === 'string' ? detections.model : 'unknown',
      source: 'detect_garments',
      fields: isRecord(g.confidence) ? g.confidence : {},
      suggested: tags,
      warnings: Array.isArray(g.warnings) ? g.warnings : [],
    },
  };
}
