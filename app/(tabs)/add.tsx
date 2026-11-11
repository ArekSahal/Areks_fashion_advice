import { EmptyState, Screen, Text } from '@/ui';

/** Add-item flow (M1c): camera/gallery → upload → AI tags → confirm. */
export default function Add() {
  return (
    <Screen>
      <Text variant="title">Add an item</Text>
      <EmptyState
        title="Camera coming next"
        body="Adding clothes with a photo is the next thing we’re building."
      />
    </Screen>
  );
}
