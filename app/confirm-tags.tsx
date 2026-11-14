import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import {
  CATEGORY_IDS,
  FORMALITY_IDS,
  MAX_SELECTED,
  TAG_ERROR_COPY,
  fieldStatus,
  formFromColumns,
  formalityLabel,
  initialForm,
  missingFields,
  missingMessage,
  setCategory,
  setSingle,
  setSubcategory,
  subcategoryOptions,
  suggestionFromStored,
  tagLabel,
  toConfirmedUpdate,
  toggleValue,
  type TagErrorKind,
  type TagForm,
} from '@/lib/confirmTags';
import { fetchItemForTagging, requestTagSuggestion, saveConfirmedTags, signedPhotoUrls } from '@/lib/items';
import { COLOURS, FITS, MATERIALS, OCCASIONS, PATTERNS, SEASONS, type Formality } from '@/lib/taxonomy';
import { Button, ChipGroup, MultiChipGroup, Screen, TagConfirmRow, Text, useTheme } from '@/ui';

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; error: Exclude<TagErrorKind, 'already_confirmed'> }
  | { kind: 'form' };

const options = <T extends string>(ids: readonly T[]) => ids.map((value) => ({ value, label: tagLabel(value) }));
const CATEGORY_OPTIONS = options(CATEGORY_IDS);
const PATTERN_OPTIONS = options(PATTERNS);
const FIT_OPTIONS = options(FITS);
const SEASON_OPTIONS = options(SEASONS);
const OCCASION_OPTIONS = options(OCCASIONS);
const MATERIAL_OPTIONS = options(Object.keys(MATERIALS) as (keyof typeof MATERIALS)[]);
const COLOUR_OPTIONS = (Object.keys(COLOURS) as (keyof typeof COLOURS)[]).map((value) => ({
  value,
  label: tagLabel(value),
  swatch: COLOURS[value].hex,
}));
const FORMALITY_OPTIONS = FORMALITY_IDS.map((f) => ({ value: String(f), label: formalityLabel(f) }));

const INTRO: Record<TagForm['source'], { title: string; body: string }> = {
  ai: { title: 'Check the tags', body: 'Here’s what we think it is. Fix anything that’s off, then save.' },
  manual: { title: 'Add tags', body: 'Pick what fits. A category and a colour are enough to start.' },
  confirmed: { title: 'Edit tags', body: 'Change anything that’s off, then save.' },
};

/** Leaves the modal for the wardrobe tab (also works after a page reload on web, when there's nothing to go back to). */
function toWardrobe() {
  if (router.canDismiss()) router.dismissTo('/');
  else router.replace('/');
}

/**
 * Confirm tags (M1c-5, issue #39): full-screen modal after adding a photo, or from a "Needs tags" item in the
 * wardrobe. Shows the AI's suggestion as editable chips; nothing counts until the user saves.
 */
export default function ConfirmTags() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = typeof id === 'string' ? id : '';
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [form, setForm] = useState<TagForm>(() => initialForm(null));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = useRef(true);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    setMessage(null);
    try {
      const item = itemId ? await fetchItemForTagging(itemId) : null;
      if (!active.current) return;
      if (!item) {
        setPhase({ kind: 'missing' });
        return;
      }
      const path = item.image_path ?? item.thumb_path;
      if (path) {
        signedPhotoUrls([path])
          .then((urls) => active.current && setPhoto(urls[path] ?? null))
          .catch(() => undefined);
      }
      if (item.tags_confirmed_at) {
        setForm(formFromColumns(item));
        setPhase({ kind: 'form' });
        return;
      }
      // A suggestion from an earlier visit is reused, so skipping and coming back costs no AI call.
      const stored = suggestionFromStored(item.tag_confidence);
      if (stored) {
        setForm(initialForm(stored));
        setPhase({ kind: 'form' });
        return;
      }
      const result = await requestTagSuggestion(itemId);
      if (!active.current) return;
      if (result.ok) {
        setForm(initialForm(result.suggestion));
        setPhase({ kind: 'form' });
      } else if (result.kind === 'already_confirmed') {
        const fresh = await fetchItemForTagging(itemId);
        if (!active.current) return;
        setForm(fresh ? formFromColumns(fresh) : initialForm(null));
        setPhase({ kind: 'form' });
      } else {
        setPhase({ kind: 'error', error: result.kind });
      }
    } catch {
      if (active.current) setPhase({ kind: 'error', error: 'unavailable' });
    }
  }, [itemId]);

  useEffect(() => {
    active.current = true;
    load();
    return () => {
      active.current = false;
    };
  }, [load]);

  function tagMyself() {
    setForm(initialForm(null));
    setMessage(null);
    setPhase({ kind: 'form' });
  }

  async function save() {
    const missing = missingMessage(missingFields(form.tags));
    if (missing) {
      setMessage(missing);
      return;
    }
    setMessage(null);
    setSaving(true);
    try {
      await saveConfirmedTags(itemId, toConfirmedUpdate(form.tags));
      if (!active.current) return;
      setSaving(false);
      toWardrobe();
    } catch {
      if (!active.current) return;
      setSaving(false);
      setMessage('We couldn’t save the tags. Check your connection and try again.');
    }
  }

  const photoWell = (
    <View
      style={{
        alignSelf: 'center',
        width: '60%',
        maxWidth: 280,
        aspectRatio: t.aspect.item,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: t.colours.surfaceSunken,
      }}
    >
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          accessibilityLabel="Your item"
        />
      ) : null}
    </View>
  );

  const skip = <Button label="Skip for now" variant="secondary" onPress={toWardrobe} disabled={saving} />;

  if (phase.kind === 'loading') {
    return (
      <Screen scroll>
        <Text variant="title">Check the tags</Text>
        {photoWell}
        <Text muted accessibilityLiveRegion="polite">
          Looking at your photo…
        </Text>
        {skip}
      </Screen>
    );
  }

  if (phase.kind === 'missing') {
    return (
      <Screen scroll>
        <Text variant="title">Check the tags</Text>
        <Text muted>We couldn’t find this item. It may have been removed.</Text>
        <Button label="Back to wardrobe" onPress={toWardrobe} />
      </Screen>
    );
  }

  if (phase.kind === 'error') {
    const copy = TAG_ERROR_COPY[phase.error];
    return (
      <Screen scroll>
        <Text variant="title">Add tags</Text>
        {photoWell}
        <Text accessibilityLiveRegion="polite">{copy.message}</Text>
        {copy.canRetry ? <Button label="Try again" onPress={load} /> : null}
        <Button label="Tag it myself" variant={copy.canRetry ? 'secondary' : 'primary'} onPress={tagMyself} />
        {skip}
      </Screen>
    );
  }

  const tags = form.tags;
  const intro = INTRO[form.source];
  const multipleGarments = form.suggestion?.warnings.includes('multiple_garments');

  return (
    <Screen scroll>
      <Text variant="title">{intro.title}</Text>
      <Text muted>{intro.body}</Text>
      {multipleGarments ? (
        <Text muted>We saw more than one piece in this photo. These tags are for the main one.</Text>
      ) : null}
      {photoWell}

      <TagConfirmRow label="Category" status={fieldStatus(form, 'category')}>
        <ChipGroup
          options={CATEGORY_OPTIONS}
          value={tags.category}
          onChange={(v) => setForm((f) => setCategory(f, v))}
        />
      </TagConfirmRow>

      <TagConfirmRow label="Type" status={fieldStatus(form, 'subcategory')}>
        <ChipGroup
          options={options(subcategoryOptions(tags.category))}
          value={tags.subcategory}
          onChange={(v) => setForm((f) => setSubcategory(f, v))}
        />
      </TagConfirmRow>

      <TagConfirmRow
        label="Colours"
        status={fieldStatus(form, 'colours')}
        hint={`Up to ${MAX_SELECTED.colours}, main colour first.`}
      >
        <MultiChipGroup
          options={COLOUR_OPTIONS}
          values={tags.colours}
          onToggle={(v) => setForm((f) => toggleValue(f, 'colours', v))}
        />
      </TagConfirmRow>

      <TagConfirmRow label="Pattern" status={fieldStatus(form, 'pattern')}>
        <ChipGroup
          options={PATTERN_OPTIONS}
          value={tags.pattern}
          onChange={(v) => setForm((f) => setSingle(f, 'pattern', v))}
        />
      </TagConfirmRow>

      <TagConfirmRow
        label="Material"
        status={fieldStatus(form, 'materials')}
        hint={`Up to ${MAX_SELECTED.materials}, main fabric first. Leave empty if you’re not sure.`}
      >
        <MultiChipGroup
          options={MATERIAL_OPTIONS}
          values={tags.materials}
          onToggle={(v) => setForm((f) => toggleValue(f, 'materials', v))}
        />
      </TagConfirmRow>

      <TagConfirmRow label="Formality" status={fieldStatus(form, 'formality')}>
        <ChipGroup
          options={FORMALITY_OPTIONS}
          value={tags.formality === null ? null : String(tags.formality)}
          onChange={(v) => setForm((f) => setSingle(f, 'formality', v === null ? null : (Number(v) as Formality)))}
        />
      </TagConfirmRow>

      <TagConfirmRow label="Seasons" status={fieldStatus(form, 'seasons')} hint="Leave empty if it works all year.">
        <MultiChipGroup
          options={SEASON_OPTIONS}
          values={tags.seasons}
          onToggle={(v) => setForm((f) => toggleValue(f, 'seasons', v))}
        />
      </TagConfirmRow>

      <TagConfirmRow label="Fit" status={fieldStatus(form, 'fit')}>
        <ChipGroup options={FIT_OPTIONS} value={tags.fit} onChange={(v) => setForm((f) => setSingle(f, 'fit', v))} />
      </TagConfirmRow>

      <TagConfirmRow label="Occasions" status={fieldStatus(form, 'occasions')}>
        <MultiChipGroup
          options={OCCASION_OPTIONS}
          values={tags.occasions}
          onToggle={(v) => setForm((f) => toggleValue(f, 'occasions', v))}
        />
      </TagConfirmRow>

      {message ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      <Button label="Save tags" onPress={save} loading={saving} />
      {form.source === 'confirmed' ? (
        <Button label="Cancel" variant="secondary" onPress={toWardrobe} disabled={saving} />
      ) : (
        skip
      )}
    </Screen>
  );
}
