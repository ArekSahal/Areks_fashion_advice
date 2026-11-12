import { router } from 'expo-router';
import { EmptyState, Screen, Text } from '@/ui';

/** Wardrobe tab. The photo grid and filters arrive with "add item" (M1c). */
export default function Wardrobe() {
  return (
    <Screen>
      <Text variant="title">Wardrobe</Text>
      <EmptyState
        title="Your wardrobe is empty"
        body="Add your first item. It takes about 30 seconds: snap a photo and check the tags."
        action={{ label: 'Add an item', onPress: () => router.navigate('/add') }}
      />
    </Screen>
  );
}
