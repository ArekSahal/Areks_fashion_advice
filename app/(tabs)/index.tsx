import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { listMyItems, signedPhotoUrls, type WardrobeItem } from '@/lib/items';
import { gridColumns } from '@/lib/photo';
import { Button, EmptyState, ItemCard, PhotoGrid, Screen, Text } from '@/ui';

type Loaded = { items: WardrobeItem[]; urls: Record<string, string> };

const SKELETON = ['a', 'b', 'c', 'd'];

function label(item: WardrobeItem): string | undefined {
  const raw = item.subcategory ?? item.category;
  if (!raw) return undefined;
  const text = raw.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Wardrobe tab: the user's items, newest first. Filters arrive later in M1. */
export default function Wardrobe() {
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (isActive: () => boolean) => {
    try {
      const items = await listMyItems();
      const paths = items.map((i) => i.thumb_path ?? i.image_path).filter((p): p is string => !!p);
      const urls = await signedPhotoUrls(paths);
      if (isActive()) {
        setData({ items, urls });
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
      <Screen centered>
        <Text>We couldn’t load your wardrobe.</Text>
        <Button
          label="Try again"
          variant="secondary"
          onPress={() => {
            setFailed(false);
            load(() => true);
          }}
        />
      </Screen>
    );
  }

  if (data && data.items.length === 0) {
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

  return (
    <Screen scroll>
      <Text variant="title">Wardrobe</Text>
      {data ? (
        <>
          <Text muted>{data.items.length === 1 ? '1 item' : `${data.items.length} items`}</Text>
          <PhotoGrid
            items={data.items}
            columns={columns}
            keyOf={(item) => item.id}
            renderItem={(item) => {
              const path = item.thumb_path ?? item.image_path;
              return <ItemCard uri={path ? (data.urls[path] ?? null) : null} label={label(item)} />;
            }}
          />
        </>
      ) : (
        <PhotoGrid items={SKELETON} columns={columns} keyOf={(k) => k} renderItem={() => <ItemCard uri={null} />} />
      )}
    </Screen>
  );
}
