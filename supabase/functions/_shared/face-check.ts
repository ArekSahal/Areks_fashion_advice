// Decides whether process-image may mark a new item as face-free (clothing_items.faces_blurred_at).
// The app runs face detection on the device and blurs faces before upload (issue #26). It reports
// `face_check`: 'blurred' | 'none' | 'skipped'. Only 'blurred' (every face found was blurred) and 'none'
// (the detector ran and found no face) count. Anything else, including a missing or unknown value from an
// older app version, leaves faces_blurred_at unset, so tag-item asks for consent (fail closed).
// Tested in src/lib/faceCheck.test.ts.

export const FACE_FREE_CHECKS = ['blurred', 'none'] as const;

/** The reported value for logs: one of the known values, 'missing', or 'invalid' (never echoes client input). */
export function faceCheckLabel(faceCheck: unknown): string {
  if (faceCheck === undefined || faceCheck === null) return 'missing';
  return faceCheck === 'blurred' || faceCheck === 'none' || faceCheck === 'skipped' ? faceCheck : 'invalid';
}

export function facesBlurredAt(faceCheck: unknown, now: Date = new Date()): string | null {
  return typeof faceCheck === 'string' && (FACE_FREE_CHECKS as readonly string[]).includes(faceCheck)
    ? now.toISOString()
    : null;
}
