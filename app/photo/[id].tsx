import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, useWindowDimensions, View } from 'react-native';
import { signedPhotoUrls } from '@/lib/items';
import { gridColumns } from '@/lib/photo';
import { fetchPhotoWithItems, itemCountLabel, type PhotoItem, type WardrobePhoto } from '@/lib/wardrobePhotos';
import { Button, EmptyState, ItemCard, PhotoGrid, Screen, Text, useTheme } from '@/ui';

type Loaded = { photo: WardrobePhoto; items: PhotoItem[]; urls: Record<string, string> } | 'missing';

/** Only tags the user confirmed are shown, as in the wardrobe grid. */
function label(item: PhotoItem): string | undefined {
  if (!item.tags_confirmed_at) return 'Needs tags';
  const raw = item.subcategory ?? item.category;
  if (!raw) return undefined;
  const text = raw.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** One outfit photo from the wardrobe and the items saved from it (#36). Tapping an item opens its tags. */
export default function PhotoScreen() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const { id } = useLocalSearchParams<{ id: string }>();
  const photoId = typeof id === 'string' ? id : '';
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (isActive: () => boolean) => {
      try {
        const found = photoId ? await fetchPhotoWithItems(photoId) : null;
        if (!found) {
          if (isActive()) setData('missing');
          return;
        }
        const paths = [found.photo.image_path, ...found.items.map((i) => i.thumb_path ?? i.image_path)].filter(
          (p): p is string => !!p,
        );
        const urls = await signedPhotoUrls(paths);
        if (isActive()) {
          setData({ ...found, urls });
          setFailed(false);
        }
      } catch {
        if (isActive()) setFailed(true);
      }
    },
    [photoId],
  );

  // Reload on focus, e.g. after confirming an item's tags.
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
        <Text variant="title">Outfit photo</Text>
        <EmptyState
          title="We couldn’t load this photo"
          body="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => load(() => true) }}
        />
        <Button label="Back" variant="secondary" onPress={back} />
      </Screen>
    );
  }

  if (data === 'missing') {
    return (
      <Screen>
        <Text variant="title">Outfit photo</Text>
        <Text muted>We couldn’t find this photo. It may have been removed.</Text>
        <Button label="Back to wardrobe" onPress={back} />
      </Screen>
    );
  }

  const imageUri = data?.photo.image_path ? (data.urls[data.photo.image_path] ?? null) : null;

  return (
    <Screen scroll>
      <Text variant="title">Outfit photo</Text>
      <View
        style={{
          alignSelf: 'stretch',
          aspectRatio: t.aspect.outfit,
          maxHeight: 560,
          borderRadius: t.radius.md,
          overflow: 'hidden',
          backgroundColor: t.colours.surfaceSunken,
        }}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel="Outfit photo" />
        ) : null}
      </View>
      {data ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            Items in this photo
          </Text>
          {data.items.length === 0 ? (
            <Text muted>{itemCountLabel(0)}. Pieces you save from this photo will show up here.</Text>
          ) : (
            <PhotoGrid
              items={data.items}
              columns={columns}
              keyOf={(item) => item.id}
              renderItem={(item) => {
                const path = item.thumb_path ?? item.image_path;
                const text = label(item);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.tags_confirmed_at ? `${text ?? 'Item'}. Edit tags` : 'Item needs tags. Add tags'}
                    onPress={() => router.push({ pathname: '/confirm-tags', params: { id: item.id } })}
                    style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
                  >
                    <ItemCard uri={path ? (data.urls[path] ?? null) : null} label={text} />
                  </Pressable>
                );
              }}
            />
          )}
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
