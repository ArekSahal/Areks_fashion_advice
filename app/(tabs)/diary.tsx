import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import {
  compareMonths,
  dayCellLabel,
  daysWithEntries,
  entriesPerDay,
  monthGrid,
  monthLabel,
  monthOf,
  monthRange,
  nextMonth,
  prevMonth,
  shortDate,
  WEEKDAY_HEADERS,
  type YearMonth,
} from '@/lib/calendar';
import {
  addDays,
  canSaveOutfit,
  createOutfit,
  dayLabel,
  DIARY_ERROR_MESSAGE,
  diaryErrorKind,
  groupByDay,
  listEntriesBetween,
  listEntriesSince,
  localDateString,
  MAX_OUTFIT_ITEMS,
  partialOutfitId,
  photoLabel,
  pieceLabel,
  RECENT_DAYS,
  saveLabel,
  toggleItem,
  updateOutfit,
  type DiaryEntry,
} from '@/lib/diary';
import { listMyItems, signedPhotoUrls, type WardrobeItem } from '@/lib/items';
import { gridColumns } from '@/lib/photo';
import { listMyPhotos, type WardrobePhoto } from '@/lib/wardrobePhotos';
import {
  Button,
  EmptyState,
  ItemCard,
  PhotoGrid,
  Screen,
  Section,
  SegmentedControl,
  Text,
  useTheme,
} from '@/ui';

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

type DiaryView = 'recent' | 'calendar';

const VIEWS: readonly { value: DiaryView; label: string }[] = [
  { value: 'recent', label: `Last ${RECENT_DAYS} days` },
  { value: 'calendar', label: 'Calendar' },
];

/** Entries loaded for one calendar month (`key` is "YYYY-M"), so a late reply for another month is never shown. */
type MonthEntries = { key: string; entries: DiaryEntry[] };

function monthKey(m: YearMonth): string {
  return `${m.year}-${m.month}`;
}

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

/** Previous / next month arrow: a full 48pt touch target. */
function MonthArrow({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: t.touchTarget,
        minHeight: t.touchTarget,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={t.space.xl} color={t.colours.text} />
    </Pressable>
  );
}

/**
 * Month grid, Monday first. Days with entries get an accent dot, today an accent outline, the selected day an accent
 * fill. Future days can't be picked. `entries` null = still loading (no dots yet, labels say only the date).
 */
function MonthCalendar({
  shown,
  today,
  entries,
  selected,
  onSelect,
  onShow,
}: {
  shown: YearMonth;
  today: string;
  entries: DiaryEntry[] | null;
  selected: string | null;
  onSelect: (day: string) => void;
  onShow: (month: YearMonth) => void;
}) {
  const t = useTheme();
  const prev = prevMonth(shown.year, shown.month);
  const next = nextMonth(shown.year, shown.month);
  const canGoNext = compareMonths(next, monthOf(today)) <= 0;
  const marked = daysWithEntries(entries ?? []);
  const counts = entriesPerDay(entries ?? []);
  const dot = t.space.sm;
  return (
    <View style={{ gap: t.space.xs, alignSelf: 'stretch' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <MonthArrow
          icon="chevron-back"
          label={`Previous month, ${monthLabel(prev.year, prev.month)}`}
          onPress={() => onShow(prev)}
        />
        <Text
          variant="heading"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={{ flex: 1, textAlign: 'center' }}
        >
          {monthLabel(shown.year, shown.month)}
        </Text>
        <MonthArrow
          icon="chevron-forward"
          label={`Next month, ${monthLabel(next.year, next.month)}`}
          disabled={!canGoNext}
          onPress={() => onShow(next)}
        />
      </View>
      {/* Column headers are for sighted users; each day's label already says its weekday. */}
      <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {WEEKDAY_HEADERS.map((w) => (
          <Text key={w} variant="caption" muted style={{ flex: 1, textAlign: 'center' }}>
            {w}
          </Text>
        ))}
      </View>
      {monthGrid(shown.year, shown.month).map((week, wi) => (
        <View key={`${monthKey(shown)}-${wi}`} style={{ flexDirection: 'row' }}>
          {week.map((day, di) => {
            if (day === null) return <View key={`pad-${di}`} style={{ flex: 1 }} />;
            const future = day > today;
            const isSelected = day === selected;
            const isToday = day === today;
            const fg = isSelected ? t.colours.onAccent : future ? t.colours.textMuted : t.colours.text;
            const dotColour = marked.has(day) ? (isSelected ? t.colours.onAccent : t.colours.accent) : 'transparent';
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={entries ? dayCellLabel(day, counts.get(day) ?? 0, today) : shortDate(day)}
                accessibilityState={{ selected: isSelected, disabled: future }}
                disabled={future}
                onPress={() => onSelect(day)}
                style={({ pressed }) => ({ flex: 1, minHeight: t.touchTarget, opacity: pressed ? 0.85 : 1 })}
              >
                <View
                  style={{
                    flex: 1,
                    margin: t.space.xxs,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: t.space.xxs,
                    paddingVertical: t.space.xxs,
                    borderRadius: t.radius.md,
                    borderWidth: 2,
                    borderColor: isToday ? t.colours.accent : 'transparent',
                    backgroundColor: isSelected ? t.colours.accent : 'transparent',
                  }}
                >
                  <Text variant="label" style={{ color: fg }}>
                    {Number(day.slice(8))}
                  </Text>
                  <View style={{ width: dot, height: dot, borderRadius: t.radius.pill, backgroundColor: dotColour }} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/**
 * Outfit diary tab (M2, #56 slice 2): post today's outfit by tapping the pieces worn (and optionally one of your
 * outfit photos), then see today's entry and, below it, either the last two weeks or a month calendar (slice 3b).
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
  const [view, setView] = useState<DiaryView>('recent');
  const [shownMonth, setShownMonth] = useState<YearMonth>(() => monthOf(localDateString()));
  // No day is picked at first: today's outfit is already shown in the Today card above the calendar.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [month, setMonth] = useState<MonthEntries | null>(null);
  const [monthFailed, setMonthFailed] = useState(false);
  const [monthRetry, setMonthRetry] = useState(0);

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

  // The calendar loads the month it shows. It reloads whenever `data` does (tab focus, a saved outfit), so new entries
  // show up; the dots already shown stay until the new reply arrives.
  useEffect(() => {
    if (view !== 'calendar' || !data) return;
    let active = true;
    const shown = { year: shownMonth.year, month: shownMonth.month };
    const { from, to } = monthRange(shown.year, shown.month);
    listEntriesBetween(from, to).then(
      (entries) => {
        if (!active) return;
        setMonth({ key: monthKey(shown), entries });
        setMonthFailed(false);
      },
      () => {
        if (active) setMonthFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [view, data, shownMonth.year, shownMonth.month, monthRetry]);

  function showMonth(next: YearMonth) {
    setShownMonth(next);
    setMonthFailed(false);
    setSelectedDay(null);
  }

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
          const stillThere = editing ? (fresh.entries.find((x) => x.id === editing.id) ?? null) : null;
          next = {
            ...next,
            editing: stillThere,
            // Entry deleted elsewhere: saving now posts a new one, so the screen reads as posting.
            isNew: next.isNew || !stillThere,
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
  const monthEntries = month && month.key === monthKey(shownMonth) ? month.entries : null;
  const selectedEntries = selectedDay
    ? (groupByDay(monthEntries ?? []).find((d) => d.day === selectedDay)?.entries ?? [])
    : [];

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
      <SegmentedControl options={VIEWS} value={view} onChange={setView} />
      {view === 'recent' ? (
        past.length > 0 ? (
          past.map((d) => (
            <Section key={d.day} title={dayLabel(d.day, data.today)}>
              {d.entries.map((entry) => (
                <EntryThumbs key={entry.id} entry={entry} data={data} columns={thumbColumns} />
              ))}
            </Section>
          ))
        ) : (
          <Text muted>Outfits you log show up here for {RECENT_DAYS} days.</Text>
        )
      ) : (
        <>
          <MonthCalendar
            shown={shownMonth}
            today={data.today}
            entries={monthEntries}
            selected={selectedDay}
            onSelect={setSelectedDay}
            onShow={showMonth}
          />
          {monthFailed && !monthEntries ? (
            <View style={{ gap: t.space.sm }}>
              <Text tone="danger" accessibilityLiveRegion="polite">
                We couldn’t load this month. Check your connection and try again.
              </Text>
              <Button
                label="Try again"
                variant="secondary"
                onPress={() => {
                  setMonthFailed(false);
                  setMonthRetry((n) => n + 1);
                }}
              />
            </View>
          ) : !monthEntries ? (
            <Text variant="caption" muted accessibilityLiveRegion="polite">
              Loading {monthLabel(shownMonth.year, shownMonth.month)}…
            </Text>
          ) : selectedDay ? (
            <Section title={dayLabel(selectedDay, data.today)}>
              {selectedEntries.length === 0 ? (
                <Text muted>Nothing logged.</Text>
              ) : (
                selectedEntries.map((entry) => (
                  <EntryThumbs key={entry.id} entry={entry} data={data} columns={thumbColumns} />
                ))
              )}
            </Section>
          ) : (
            <Text muted>Tap a day to see what you wore.</Text>
          )}
        </>
      )}
    </Screen>
  );
}
