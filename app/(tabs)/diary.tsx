import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import {
  addDays,
  canSaveOutfit,
  createOutfit,
  dayLabel,
  DIARY_ERROR_MESSAGE,
  diaryErrorKind,
  groupByDay,
  listEntriesSince,
  localDateString,
  MAX_OUTFIT_ITEMS,
  partialOutfitId,
  photoLabel,
  pieceLabel,
  RECENT_DAYS,
  saveLabel,
  shortDate,
  toggleItem,
  updateOutfit,
  type DiaryEntry,
} from '@/lib/diary';
import { listMyItems, signedPhotoUrls, type WardrobeItem } from '@/lib/items';
import { gridColumns } from '@/lib/photo';
import { listMyPhotos, type WardrobePhoto } from '@/lib/wardrobePhotos';
import { Button, EmptyState, ItemCard, PhotoGrid, Screen, Section, Text, useTheme } from '@/ui';

type Loaded = {
  today: string;
  items: WardrobeItem[];
  photos: WardrobePhoto[];
  entries: DiaryEntry[];
  urls: Record<string, string>;
};

/**
 * The outfit being posted (editing null) or edited. `isNew` stays true when a post was saved without its items and
 * the retry links into that entry (PartialOutfitError), so the screen still reads as posting.
 */
type Draft = { editing: DiaryEntry | null; isNew: boolean; itemIds: string[]; photoId: string | null };

const SKELETON = ['a', 'b', 'c', 'd'];

function thumbOf(row: { thumb_path: string | null; image_path: string | null }, urls: Record<string, string>) {
  const path = row.thumb_path ?? row.image_path;
  return path ? (urls[path] ?? null) : null;
}

/** Small read-only view of one entry: the outfit photo (if any), then the pieces worn. */
function EntryThumbs({ entry, data, columns }: { entry: DiaryEntry; data: Loaded; columns: number }) {
  const t = useTheme();
  const photo = entry.photo_id ? data.photos.find((p) => p.id === entry.photo_id) : undefined;
  const items = entry.item_ids
    .map((id) => data.items.find((i) => i.id === id))
    .filter((i): i is WardrobeItem => !!i);
  const count = entry.item_ids.length;
  return (
    <View style={{ gap: t.space.sm }}>
      {photo ? (
        <PhotoGrid
          items={[photo]}
          columns={columns}
          keyOf={(p) => p.id}
          renderItem={(p) => <ItemCard shape="outfit" uri={thumbOf(p, data.urls)} />}
        />
      ) : null}
      {items.length > 0 ? (
        <PhotoGrid
          items={items}
          columns={columns}
          keyOf={(i) => i.id}
          renderItem={(i) => <ItemCard uri={thumbOf(i, data.urls)} label={pieceLabel(i)} />}
        />
      ) : null}
      <Text variant="caption" muted>
        {count === 0 ? (photo ? 'Photo only' : 'No pieces logged') : count === 1 ? '1 piece' : `${count} pieces`}
      </Text>
    </View>
  );
}

/**
 * Outfit diary tab (M2, #56 slice 2): post today's outfit by tapping the pieces worn (and optionally one of your
 * outfit photos), then see today's entry and the last two weeks. Calendar and wear counts come in slice 3.
 */
export default function Diary() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const thumbColumns = Math.max(4, columns * 2);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async (isActive: () => boolean = () => true): Promise<Loaded | null> => {
    try {
      const today = localDateString();
      const [items, photos, entries] = await Promise.all([
        listMyItems(),
        listMyPhotos(),
        listEntriesSince(addDays(today, -(RECENT_DAYS - 1))),
      ]);
      const paths = [...items, ...photos].map((i) => i.thumb_path ?? i.image_path).filter((p): p is string => !!p);
      const urls = await signedPhotoUrls(paths);
      const loaded = { today, items, photos, entries, urls };
      if (isActive()) {
        setData(loaded);
        setFailed(false);
      }
      return loaded;
    } catch {
      if (isActive()) setFailed(true);
      return null;
    }
  }, []);

  // Reload whenever the tab comes into focus (new items, a new day). An open draft is kept.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      load(() => active);
      return () => {
        active = false;
      };
    }, [load]),
  );

  function startDraft(editing: DiaryEntry | null) {
    setError(null);
    setNotice(null);
    setDraft({
      editing,
      isNew: !editing,
      itemIds: editing ? [...editing.item_ids] : [],
      photoId: editing?.photo_id ?? null,
    });
  }

  function toggle(itemId: string) {
    if (!draft) return;
    const next = toggleItem(draft.itemIds, itemId);
    if (next.length === draft.itemIds.length && !draft.itemIds.includes(itemId)) {
      setError(`An outfit can hold up to ${MAX_OUTFIT_ITEMS} pieces.`);
      return;
    }
    setError(null);
    setDraft({ ...draft, itemIds: next });
  }

  async function save() {
    if (!draft || savingRef.current || !canSaveOutfit(draft.itemIds, draft.photoId)) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const today = localDateString();
    try {
      if (draft.editing) await updateOutfit(draft.editing, draft.itemIds, draft.photoId);
      else await createOutfit(today, draft.itemIds, draft.photoId);
      const fresh = await load();
      setDraft(null);
      if (fresh) setNotice(draft.isNew ? 'Saved to today’s diary.' : 'Outfit updated.');
      else setData(null); // saved, but the reload failed: show the retry screen, not a stale "Nothing logged yet"
    } catch (e) {
      const kind = diaryErrorKind(e);
      setError(DIARY_ERROR_MESSAGE[kind]);
      // The entry was saved without its items and couldn't be removed: the retry links into it instead of posting twice.
      const savedId = partialOutfitId(e);
      const editing: DiaryEntry | null = savedId
        ? { id: savedId, worn_on: today, photo_id: draft.photoId, created_at: new Date().toISOString(), item_ids: [] }
        : draft.editing;
      let next: Draft = { ...draft, editing };
      if (kind === 'stale') {
        // Drop pieces or a photo that no longer exist, and re-read the entry, so the retry can succeed.
        const fresh = await load();
        if (fresh) {
          const itemIds = new Set(fresh.items.map((i) => i.id));
          const photoIds = new Set(fresh.photos.map((p) => p.id));
          next = {
            ...next,
            editing: editing ? (fresh.entries.find((x) => x.id === editing.id) ?? null) : null,
            itemIds: draft.itemIds.filter((id) => itemIds.has(id)),
            photoId: draft.photoId && photoIds.has(draft.photoId) ? draft.photoId : null,
          };
        }
      }
      setDraft(next);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (failed && !data) {
    return (
      <Screen>
        <Text variant="title">Diary</Text>
        <EmptyState
          title="We couldn’t load your diary"
          body="Check your connection and try again."
          action={{
            label: 'Try again',
            onPress: () => {
              setFailed(false);
              load();
            },
          }}
        />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <Text variant="title">Diary</Text>
        <View accessible accessibilityLabel="Loading your diary">
          <PhotoGrid items={SKELETON} columns={columns} keyOf={(k) => k} renderItem={() => <ItemCard uri={null} />} />
        </View>
      </Screen>
    );
  }

  // Composer: tap pieces (and optionally a photo), then save. Save stays visible below the scrolling grid.
  if (draft) {
    const ready = canSaveOutfit(draft.itemIds, draft.photoId);
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: t.space.md, paddingBottom: t.space.lg }}>
          <Text variant="title">{draft.isNew ? 'Today’s outfit' : 'Edit outfit'}</Text>
          <Text muted>
            {data.items.length > 0 ? 'Tap the pieces you’re wearing.' : 'Your wardrobe has no pieces yet.'}
          </Text>
          {data.items.length > 0 ? (
            <PhotoGrid
              items={data.items}
              columns={columns}
              keyOf={(i) => i.id}
              renderItem={(item) => {
                const selected = draft.itemIds.includes(item.id);
                const name = pieceLabel(item) ?? 'Item without tags';
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={name}
                    accessibilityState={{ checked: selected, disabled: saving }}
                    disabled={saving}
                    onPress={() => toggle(item.id)}
                    style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
                  >
                    <ItemCard uri={thumbOf(item, data.urls)} label={pieceLabel(item)} selected={selected} />
                  </Pressable>
                );
              }}
            />
          ) : (
            <Button label="Add an item" variant="secondary" onPress={() => router.navigate('/add')} />
          )}
          {data.photos.length > 0 ? (
            <>
              <Text variant="heading">Add a photo (optional)</Text>
              <Text variant="caption" muted>
                Pick one of your outfit photos. Tap it again to remove it.
              </Text>
              <PhotoGrid
                items={data.photos}
                columns={columns}
                keyOf={(p) => p.id}
                renderItem={(photo) => {
                  const selected = draft.photoId === photo.id;
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={photoLabel(data.photos.indexOf(photo), data.photos.length, photo.created_at)}
                      accessibilityState={{ checked: selected, disabled: saving }}
                      disabled={saving}
                      onPress={() => setDraft({ ...draft, photoId: selected ? null : photo.id })}
                      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
                    >
                      <ItemCard shape="outfit" uri={thumbOf(photo, data.urls)} selected={selected} />
                    </Pressable>
                  );
                }}
              />
            </>
          ) : null}
        </ScrollView>
        <View style={{ gap: t.space.sm }}>
          {error ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : !ready ? (
            <Text variant="caption" muted>
              Pick at least one piece{data.photos.length > 0 ? ' or a photo' : ''}.
            </Text>
          ) : null}
          <Button
            label={saveLabel(draft.itemIds.length, !draft.isNew)}
            onPress={save}
            disabled={!ready}
            loading={saving}
          />
          <Button label="Cancel" variant="secondary" disabled={saving} onPress={() => setDraft(null)} />
        </View>
      </Screen>
    );
  }

  // Nothing to log yet: the diary links pieces from the wardrobe.
  if (data.items.length === 0 && data.photos.length === 0) {
    return (
      <Screen>
        <Text variant="title">Diary</Text>
        <EmptyState
          title="Add your clothes first"
          body="The diary links what you wear to pieces in your wardrobe. Add a few items, then post today’s outfit here."
          action={{ label: 'Add an item', onPress: () => router.navigate('/add') }}
        />
      </Screen>
    );
  }

  const days = groupByDay(data.entries);
  const todays = days.find((d) => d.day === data.today)?.entries ?? [];
  const past = days.filter((d) => d.day < data.today);

  return (
    <Screen scroll>
      <Text variant="title">Diary</Text>
      {notice ? (
        <Text tone="success" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <Section title={`Today · ${shortDate(data.today)}`}>
        {todays.length === 0 ? (
          <Text muted>Nothing logged yet. It only takes a few taps.</Text>
        ) : (
          todays.map((entry, i) => (
            <View key={entry.id} style={{ gap: t.space.sm }}>
              {todays.length > 1 ? <Text variant="label">Outfit {i + 1}</Text> : null}
              <EntryThumbs entry={entry} data={data} columns={thumbColumns} />
              <Button
                label={todays.length > 1 ? `Edit outfit ${i + 1}` : 'Edit outfit'}
                variant="secondary"
                onPress={() => startDraft(entry)}
              />
            </View>
          ))
        )}
        <Button
          label={todays.length === 0 ? 'Post today’s outfit' : 'Add another outfit'}
          onPress={() => startDraft(null)}
        />
      </Section>
      {past.length > 0 ? (
        <>
          <Text variant="heading">Last {RECENT_DAYS} days</Text>
          {past.map((d) => (
            <Section key={d.day} title={dayLabel(d.day, data.today)}>
              {d.entries.map((entry) => (
                <EntryThumbs key={entry.id} entry={entry} data={data} columns={thumbColumns} />
              ))}
            </Section>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
