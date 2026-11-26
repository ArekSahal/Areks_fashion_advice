import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { listMyItems, signedPhotoUrls, type WardrobeItem } from '@/lib/items';
import { gridColumns } from '@/lib/photo';
import { itemCountLabel, itemCountsByPhoto, listMyPhotos, type WardrobePhoto } from '@/lib/wardrobePhotos';
import { EmptyState, ItemCard, PhotoGrid, Screen, SegmentedControl, Text } from '@/ui';

type Loaded = {
  items: WardrobeItem[];
  photos: WardrobePhoto[];
  counts: Record<string, number>;
  urls: Record<string, string>;
};
type WardrobeView = 'items' | 'outfits';

const VIEWS = [
  { value: 'items', label: 'Items' },
  { value: 'outfits', label: 'Outfits' },
] as const satisfies readonly { value: WardrobeView; label: string }[];

const SKELETON = ['a', 'b', 'c', 'd'];

/** Only tags the user confirmed are shown; AI suggestions stay hidden until the confirm-tags step. */
function label(item: WardrobeItem): string | undefined {
  if (!item.tags_confirmed_at) return 'Needs tags';
  const raw = item.subcategory ?? item.category;
  if (!raw) return undefined;
  const text = raw.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Wardrobe tab: the user's items, newest first, or (Outfits) the original photos items were cut from (#36).
 * Filters arrive later in M1.
 */
export default function Wardrobe() {
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<WardrobeView>('items');

  const load = useCallback(async (isActive: () => boolean) => {
    try {
      const [items, photos, counts] = await Promise.all([listMyItems(), listMyPhotos(), itemCountsByPhoto()]);
      const paths = [...items, ...photos].map((i) => i.thumb_path ?? i.image_path).filter((p): p is string => !!p);
      const urls = await signedPhotoUrls(paths);
      if (isActive()) {
        setData({ items, photos, counts, urls });
        setFailed(false);
      }
    } catch {
      if (isActive()) setFailed(true);
    }
  }, []);

  // Reload whenever the tab comes into focus, e.g. after adding an item.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      load(() => active);
      return () => {
        active = false;
      };
    }, [load]),
  );

  if (failed && !data) {
    return (
      <Screen>
        <Text variant="title">Wardrobe</Text>
        <EmptyState
          title="We couldn’t load your wardrobe"
          body="Check your connection and try again."
          action={{
            label: 'Try again',
            onPress: () => {
              setFailed(false);
              load(() => true);
            },
          }}
        />
      </Screen>
    );
  }

  // Brand-new wardrobe (nothing at all yet): one clear next step, no switch.
  if (data && data.items.length === 0 && data.photos.length === 0) {
    return (
      <Screen>
        <Text variant="title">Wardrobe</Text>
        <EmptyState
          title="Your wardrobe is empty"
          body="Add your first item. It takes about 30 seconds: pick a photo and you’re done."
          action={{ label: 'Add an item', onPress: () => router.navigate('/add') }}
        />
      </Screen>
    );
  }

  const toggle = <SegmentedControl options={VIEWS} value={view} onChange={setView} />;

  if (data && view === 'outfits') {
    return (
      <Screen scroll>
        <Text variant="title">Wardrobe</Text>
        {toggle}
        {data.photos.length === 0 ? (
          <EmptyState
            title="No outfit photos yet"
            body="Soon you can add a photo of a whole outfit and save each piece from it. Your photos will show up here."
          />
        ) : (
          <>
            <Text muted>{data.photos.length === 1 ? '1 photo' : `${data.photos.length} photos`}</Text>
            <PhotoGrid
              items={data.photos}
              columns={columns}
              keyOf={(photo) => photo.id}
              renderItem={(photo) => {
                const path = photo.thumb_path ?? photo.image_path;
                const count = itemCountLabel(data.counts[photo.id] ?? 0);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Outfit photo, ${count}. Open`}
                    onPress={() => router.push({ pathname: '/photo/[id]', params: { id: photo.id } })}
                    style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
                  >
                    <ItemCard shape="outfit" uri={path ? (data.urls[path] ?? null) : null} label={count} />
                  </Pressable>
                );
              }}
            />
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text variant="title">Wardrobe</Text>
      {data ? toggle : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="No items yet"
          body="Pieces you save show up here. Your outfit photos are under Outfits."
          action={{ label: 'Add an item', onPress: () => router.navigate('/add') }}
        />
      ) : data ? (
        <>
          <Text muted>{data.items.length === 1 ? '1 item' : `${data.items.length} items`}</Text>
          <PhotoGrid
            items={data.items}
            columns={columns}
            keyOf={(item) => item.id}
            renderItem={(item) => {
              const path = item.thumb_path ?? item.image_path;
              const text = label(item);
              const card = <ItemCard uri={path ? (data.urls[path] ?? null) : null} label={text} />;
              // Tagged items open the item screen (wear count, #56); untagged (skipped) items open confirm-tags.
              return item.tags_confirmed_at ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${text ?? 'Item'}. Open`}
                  onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
                  style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
                >
                  {card}
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Item needs tags. Add tags"
                  onPress={() => router.push({ pathname: '/confirm-tags', params: { id: item.id } })}
                  style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
                >
                  {card}
                </Pressable>
              );
            }}
          />
        </>
      ) : (
        <View accessible accessibilityLabel="Loading your wardrobe">
          <PhotoGrid items={SKELETON} columns={columns} keyOf={(k) => k} renderItem={() => <ItemCard uri={null} />} />
        </View>
      )}
    </Screen>
  );
}
