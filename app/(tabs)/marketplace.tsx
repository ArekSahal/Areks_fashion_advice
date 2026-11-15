import { useState } from 'react';
import { EmptyState, Screen, SegmentedControl, Text } from '@/ui';

type MarketView = 'second_hand' | 'shop';

const VIEWS = [
  { value: 'second_hand', label: 'Second-hand' },
  { value: 'shop', label: 'Shop' },
] as const satisfies readonly { value: MarketView; label: string }[];

/**
 * Marketplace tab (docs/DECISIONS.md, 2026-11-15): second-hand from other users (M4) and the Channel3 Shop (M1.5).
 * Both are placeholders until those milestones ship.
 */
export default function Marketplace() {
  const [view, setView] = useState<MarketView>('second_hand');
  return (
    <Screen>
      <Text variant="title">Marketplace</Text>
      <SegmentedControl options={VIEWS} value={view} onChange={setView} />
      {view === 'second_hand' ? (
        <EmptyState
          title="Pre-loved from other people"
          body="Soon you can sell pieces you don’t wear and find second-hand clothes that fit your wardrobe."
        />
      ) : (
        <EmptyState
          title="Shop online stores"
          body="Soon you can search clothes from online shops here, with second-hand offers first."
        />
      )}
    </Screen>
  );
}
