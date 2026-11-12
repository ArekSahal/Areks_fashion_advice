import { EmptyState, Screen, Text } from '@/ui';

/** Outfit diary tab (M2). */
export default function Diary() {
  return (
    <Screen>
      <Text variant="title">Diary</Text>
      <EmptyState
        title="Log what you wear"
        body="Soon you can post today’s outfit and see what you wear most. Coming after the wardrobe."
      />
    </Screen>
  );
}
