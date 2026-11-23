import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Image, Pressable, useWindowDimensions, View } from 'react-native';
import { boxToCropRect } from '@/lib/detection';
import {
  CROP_PADDING,
  DETECT_ERROR_COPY,
  cropPreviewLayout,
  garmentA11yLabel,
  initialSelection,
  outcomeCaption,
  pendingIndexes,
  saveGarmentsInOrder,
  saveLabel,
  saveSummary,
  toggleSelection,
  type DetectErrorKind,
  type PickerGarment,
  type SaveOutcome,
} from '@/lib/garmentPicker';
import { gridColumns, type PreparedPhoto } from '@/lib/photo';
import { cropPhoto } from '@/lib/preparePhoto';
import { updateProfile } from '@/lib/profile';
import { addOutfitPhoto, deleteWardrobePhoto, detectGarments, saveGarment } from '@/lib/wardrobePhotos';
import { Button, PhotoGrid, Text } from './components';
import { useTheme } from './theme';

type Phase =
  | { kind: 'uploading' }
  | { kind: 'upload_failed' }
  | { kind: 'detecting' }
  | { kind: 'detect_failed'; error: DetectErrorKind }
  | { kind: 'review' }
  | { kind: 'saving'; done: number; total: number };

/** Tick state of a tile: picked or not, then how its save went. */
type TileState = 'unticked' | 'ticked' | 'saved' | 'failed';

function tileState(selected: boolean, outcome: SaveOutcome | undefined): TileState {
  if (outcome === 'saved' || outcome === 'already_saved') return 'saved';
  if (selected && outcome === 'failed') return 'failed';
  return selected ? 'ticked' : 'unticked';
}

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * One detected garment, cut out of the outfit photo on screen (no extra image work) with a mark in the corner:
 * an empty ring (unticked), an accent tick (ticked), a green double tick (saved) or a red alert (couldn't save).
 */
function GarmentTile({
  garment,
  selected,
  outcome,
  disabled,
  previewUri,
  photoWidth,
  photoHeight,
  onToggle,
}: {
  garment: PickerGarment;
  selected: boolean;
  outcome: SaveOutcome | undefined;
  disabled: boolean;
  previewUri: string;
  photoWidth: number;
  photoHeight: number;
  onToggle: () => void;
}) {
  const t = useTheme();
  const [tile, setTile] = useState<{ width: number; height: number } | null>(null);
  const layout = tile
    ? cropPreviewLayout(garment.box, photoWidth, photoHeight, tile.width, tile.height, CROP_PADDING)
    : null;
  const state = tileState(selected, outcome);
  const caption = outcomeCaption(outcome);
  const marks: Record<TileState, { icon: IconName; fg: string; bg: string; border: string }> = {
    unticked: { icon: 'ellipse-outline', fg: t.colours.borderStrong, bg: t.colours.surface, border: t.colours.border },
    ticked: { icon: 'checkmark-circle', fg: t.colours.onAccent, bg: t.colours.accent, border: t.colours.accent },
    saved: { icon: 'checkmark-done-circle', fg: t.colours.onAccent, bg: t.colours.success, border: t.colours.success },
    failed: { icon: 'alert-circle', fg: t.colours.onAccent, bg: t.colours.danger, border: t.colours.danger },
  };
  const mark = marks[state];
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={garmentA11yLabel(garment, outcome)}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => ({ flex: 1, gap: t.space.xs, opacity: pressed ? 0.85 : 1 })}
    >
      <View
        onLayout={(e) => setTile({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        style={{
          aspectRatio: t.aspect.item,
          borderRadius: t.radius.md,
          overflow: 'hidden',
          backgroundColor: t.colours.surfaceSunken,
          borderWidth: t.space.xxs,
          borderColor: mark.border,
        }}
      >
        {layout ? (
          <Image
            source={{ uri: previewUri }}
            resizeMode="stretch"
            accessibilityIgnoresInvertColors
            // Saved pieces are already in the wardrobe: dimmed so the ones still to do stand out.
            style={{ position: 'absolute', ...layout, opacity: state === 'saved' ? 0.6 : 1 }}
          />
        ) : null}
        <View
          style={{
            position: 'absolute',
            top: t.space.sm,
            right: t.space.sm,
            borderRadius: t.radius.pill,
            backgroundColor: mark.bg,
          }}
        >
          <Ionicons name={mark.icon} size={t.space.xl} color={mark.fg} />
        </View>
      </View>
      <Text variant="label" numberOfLines={2}>
        {garment.label}
      </Text>
      {caption ? (
        <Text variant="caption" tone={caption.tone}>
          {caption.text}
        </Text>
      ) : garment.uncertain ? (
        <Text variant="caption" muted>
          Not sure this is a separate piece
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * "Outfit photo" Add flow (#36 slice 3b): stores the outfit photo, finds the garments in it (detect-garments), lets
 * the user tick the ones to keep and saves each as an item linked to the photo. Cropping uses the prepared photo,
 * which was face-blurred and stripped of EXIF on the device before anything left it (docs/architecture.md → Faces).
 */
export function OutfitPhotoFlow({
  userId,
  photo,
  previewUri,
  onDone,
  onCancel,
}: {
  userId: string;
  /** The prepared (face-blurred, re-encoded) photo. */
  photo: PreparedPhoto;
  /** Shown on screen only; never uploaded. */
  previewUri: string;
  onDone: (photoId: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const [phase, setPhase] = useState<Phase>({ kind: 'uploading' });
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [garments, setGarments] = useState<PickerGarment[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [outcomes, setOutcomes] = useState<Record<number, SaveOutcome>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [consenting, setConsenting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const active = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const detect = useCallback(async (id: string) => {
    const result = await detectGarments(id);
    if (!active.current) return;
    if (!result.ok) {
      setPhase({ kind: 'detect_failed', error: result.kind });
      return;
    }
    setGarments(result.garments);
    setSelected(initialSelection(result.garments));
    setPhase({ kind: 'review' });
  }, []);

  /** Stores the outfit photo, then looks for garments. The phase is already 'uploading' when this runs. */
  const upload = useCallback(async () => {
    try {
      const id = await addOutfitPhoto(userId, photo);
      if (!active.current) return;
      setPhotoId(id);
      setPhase({ kind: 'detecting' });
      await detect(id);
    } catch {
      if (active.current) setPhase({ kind: 'upload_failed' });
    }
  }, [userId, photo, detect]);

  // Start once, when the flow opens with a prepared photo.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    upload();
  }, [upload]);

  function retryUpload() {
    setMessage(null);
    setPhase({ kind: 'uploading' });
    upload();
  }

  function retryDetect(id: string) {
    setMessage(null);
    setPhase({ kind: 'detecting' });
    detect(id);
  }

  /** "Let AI see faces": turns on the Profile consent, then looks for garments again (issue #26). */
  async function allowFaces() {
    if (!photoId) return;
    setConsenting(true);
    try {
      await updateProfile(userId, { consent_face_analysis: true });
      if (active.current) retryDetect(photoId);
    } catch {
      if (active.current) setMessage('Couldn’t change that setting. Please try again.');
    } finally {
      if (active.current) setConsenting(false);
    }
  }

  /**
   * Cancel / "Add one item instead": if the photo was stored but nothing was saved from it, remove it so no empty
   * outfit photo is left in the wardrobe. If removing fails, stay here and say so (the user can try again).
   */
  async function leave() {
    const nothingSaved = !Object.values(outcomes).some((o) => o === 'saved' || o === 'already_saved');
    if (!photoId || !nothingSaved) {
      onCancel();
      return;
    }
    setLeaving(true);
    setMessage(null);
    try {
      await deleteWardrobePhoto(photoId);
      if (active.current) onCancel();
    } catch {
      if (active.current) setMessage('We couldn’t remove the photo. Check your connection and try again.');
    } finally {
      if (active.current) setLeaving(false);
    }
  }

  async function save() {
    if (!photoId) return;
    const todo = pendingIndexes(selected, outcomes);
    if (todo.length === 0) return;
    setMessage(null);
    const total = selected.length;
    const alreadyDone = total - todo.length;
    setPhase({ kind: 'saving', done: alreadyDone, total });
    const byIndex = new Map(garments.map((g) => [g.index, g]));
    const result = await saveGarmentsInOrder(
      todo,
      async (index) => {
        const garment = byIndex.get(index);
        const rect = garment ? boxToCropRect(garment.box, photo.width, photo.height, CROP_PADDING) : null;
        if (!rect) return 'failed';
        return saveGarment(userId, photoId, index, await cropPhoto(photo, rect));
      },
      outcomes,
      (progress) => {
        if (!active.current) return;
        setOutcomes(progress);
        setPhase({ kind: 'saving', done: total - pendingIndexes(selected, progress).length, total });
      },
    );
    if (!active.current) return;
    setOutcomes(result);
    const summary = saveSummary(selected, result);
    if (summary) {
      setMessage(summary);
      setPhase({ kind: 'review' });
    } else {
      onDone(photoId);
    }
  }

  const photoWell = (
    <View
      style={{
        alignSelf: 'center',
        width: '70%',
        maxWidth: 320,
        aspectRatio: t.aspect.outfit,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: t.colours.surfaceSunken,
      }}
    >
      <Image
        source={{ uri: previewUri }}
        style={{ flex: 1 }}
        resizeMode="contain"
        accessibilityLabel="Selected outfit photo"
      />
    </View>
  );

  if (phase.kind === 'uploading' || phase.kind === 'detecting') {
    return (
      <>
        {photoWell}
        <Text muted accessibilityLiveRegion="polite">
          {phase.kind === 'uploading' ? 'Saving your outfit photo…' : 'Finding the clothes in your photo…'}
        </Text>
      </>
    );
  }

  if (phase.kind === 'upload_failed') {
    return (
      <>
        {photoWell}
        <Text tone="danger" accessibilityLiveRegion="polite">
          We couldn’t save that photo. Check your connection and try again.
        </Text>
        <Button label="Try again" onPress={retryUpload} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </>
    );
  }

  if (phase.kind === 'detect_failed') {
    const copy = DETECT_ERROR_COPY[phase.error];
    return (
      <>
        {photoWell}
        <Text accessibilityLiveRegion="polite">{copy.message}</Text>
        <Text muted>If you add one item instead, we’ll remove this outfit photo.</Text>
        {message ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
        {copy.canRetry && photoId ? (
          <Button label="Try again" onPress={() => retryDetect(photoId)} disabled={leaving} />
        ) : null}
        <Button
          label="Add one item instead"
          variant={copy.canRetry ? 'secondary' : 'primary'}
          onPress={leave}
          disabled={consenting}
          loading={leaving}
        />
        {/* Privacy first: adding pieces one by one stays the main action; sharing faces is the secondary choice. */}
        {phase.error === 'needs_face_consent' ? (
          <Button
            label="Let AI see faces"
            variant="secondary"
            onPress={allowFaces}
            loading={consenting}
            disabled={leaving}
          />
        ) : null}
      </>
    );
  }

  const saving = phase.kind === 'saving';
  const isSaved = (i: number) => outcomes[i] === 'saved' || outcomes[i] === 'already_saved';
  const leftToSave = pendingIndexes(selected, outcomes).length;
  const anySaved = selected.some(isSaved);

  return (
    <>
      <Text variant="heading" accessibilityRole="header">
        {garments.length === 1 ? 'We found 1 piece' : `We found ${garments.length} pieces`}
      </Text>
      <Text muted>Tick the ones you want to save. You can check their tags on the next screen.</Text>
      <PhotoGrid
        items={garments}
        columns={columns}
        keyOf={(g) => String(g.index)}
        renderItem={(g) => (
          <GarmentTile
            garment={g}
            selected={selected.includes(g.index)}
            // A failed piece the user unticked is just unticked again.
            outcome={selected.includes(g.index) || isSaved(g.index) ? outcomes[g.index] : undefined}
            // A saved garment can't be unticked: it's already in the wardrobe.
            disabled={saving || leaving || isSaved(g.index)}
            previewUri={previewUri}
            photoWidth={photo.width}
            photoHeight={photo.height}
            onToggle={() => setSelected((s) => toggleSelection(s, g.index))}
          />
        )}
      />
      <Text muted accessibilityLiveRegion="polite">
        {saving ? `Saving ${Math.min(phase.done + 1, phase.total)} of ${phase.total}…` : ''}
      </Text>
      {message ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {anySaved && leftToSave === 0 ? null : (
        <Button
          label={anySaved && !saving ? 'Try again' : saveLabel(selected.length)}
          onPress={save}
          disabled={leftToSave === 0 || leaving}
          loading={saving}
        />
      )}
      {anySaved && photoId ? (
        // Nothing left to save: Done is the main action.
        <Button
          label="Done"
          variant={leftToSave === 0 ? 'primary' : 'secondary'}
          onPress={() => onDone(photoId)}
          disabled={saving}
        />
      ) : (
        <Button label="Cancel" variant="secondary" onPress={leave} disabled={saving} loading={leaving} />
      )}
    </>
  );
}
