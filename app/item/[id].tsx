import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { localDateString, pieceLabel } from '@/lib/diary';
import { getMyItem, signedPhotoUrls, type WardrobeItem } from '@/lib/items';
import { getItemWearStats, wearSummary, type WearStats } from '@/lib/wearStats';
import { Button, EmptyState, Screen, Section, Text, useTheme } from '@/ui';

type Loaded = { item: WardrobeItem; stats: WearStats; uri: string | null } | 'missing';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * One wardrobe item (#56 slice 3a): the photo, its confirmed tags and how often it was worn, from the diary.
 * Unconfirmed AI tags are never shown as facts (same rule as the wardrobe grid).
 */
export default function ItemScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = typeof id === 'string' ? id : '';
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (isActive: () => boolean) => {
      if (!itemId) {
        setData('missing');
        return;
      }
      try {
        const [item, stats] = await Promise.all([getMyItem(itemId), getItemWearStats(itemId)]);
        if (!item) {
          if (isActive()) setData('missing');
          return;
        }
        // The full photo is the hero here; the thumbnail only if there is no full one.
        const path = item.image_path ?? item.thumb_path;
        const urls = path ? await signedPhotoUrls([path]) : {};
        if (isActive()) {
          setData({ item, stats, uri: path ? (urls[path] ?? null) : null });
          setFailed(false);
        }
      } catch {
        if (isActive()) setFailed(true);
      }
    },
    [itemId],
  );

  // Reload on focus, e.g. after editing tags or logging an outfit.
  // `focused` lets "Try again" skip state updates once the screen has gone (unmounted or left).
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      focused.current = true;
      load(() => active);
      return () => {
        active = false;
        focused.current = false;
      };
    }, [load]),
  );

  if (failed && !data) {
    return (
      <Screen>
        <Text variant="title" accessibilityRole="header">
          Item
        </Text>
        <EmptyState
          title="We couldn’t load this item"
          body="Check your connection and try again."
          action={{
            label: 'Try again',
            onPress: () => {
              setFailed(false);
              load(() => focused.current);
            },
          }}
        />
        <Button label="Back" variant="secondary" onPress={back} />
      </Screen>
    );
  }

  if (data === 'missing') {
    return (
      <Screen>
        <Text variant="title" accessibilityRole="header">
          Item
        </Text>
        <Text muted>We couldn’t find this item. It may have been removed.</Text>
        <Button label="Back to wardrobe" onPress={back} />
      </Screen>
    );
  }

  const confirmed = !!data?.item.tags_confirmed_at;
  const name = data ? (pieceLabel(data.item) ?? 'Item') : 'Item';
  const summary = data ? wearSummary(data.stats, localDateString()) : null;
  const neverWorn = data ? data.stats.wear_count === 0 : false;

  return (
    <Screen scroll>
      <Text variant="title" accessibilityRole="header">
        {name}
      </Text>
      <View
        style={{
          alignSelf: 'stretch',
          aspectRatio: t.aspect.item,
          maxHeight: 560,
          borderRadius: t.radius.md,
          overflow: 'hidden',
          backgroundColor: t.colours.surfaceSunken,
        }}
      >
        {data?.uri ? (
          <Image source={{ uri: data.uri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={`Photo of ${name}`} />
        ) : null}
      </View>
      {data ? (
        <>
          {confirmed ? null : <Text muted>This item needs tags before it shows what it is.</Text>}
          <Section title="Worn">
            <Text accessibilityLiveRegion="polite">{summary}</Text>
            {neverWorn ? (
              <>
                <Text muted>Log an outfit with it in the Diary to start counting.</Text>
                <Button label="Log it in the Diary" variant="secondary" onPress={() => router.navigate('/diary')} />
              </>
            ) : null}
          </Section>
          <Button
            label={confirmed ? 'Edit tags' : 'Add tags'}
            variant={confirmed ? 'secondary' : 'primary'}
            onPress={() => router.push({ pathname: '/confirm-tags', params: { id: data.item.id, from: 'item' } })}
          />
        </>
      ) : (
        <Text muted accessibilityLiveRegion="polite">
          Loading…
        </Text>
      )}
      <Button label="Back" variant="secondary" onPress={back} />
    </Screen>
  );
}
