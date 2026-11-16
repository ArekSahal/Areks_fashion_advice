import { useState } from 'react';
import { EmptyState, Screen, SegmentedControl, Text } from '@/ui';
import { ShopView } from '@/ui/ShopView';

type MarketView = 'second_hand' | 'shop';

const VIEWS = [
  { value: 'second_hand', label: 'Second-hand' },
  { value: 'shop', label: 'Shop' },
] as const satisfies readonly { value: MarketView; label: string }[];

/**
 * Market tab (docs/DECISIONS.md): second-hand from other users (M4, placeholder until then) and the Channel3 Shop
 * (M1.5, search only; the AI stylist comes after M3).
 */
export default function Marketplace() {
  const [view, setView] = useState<MarketView>('second_hand');
  return (
    <Screen scroll>
      <Text variant="title">Market</Text>
      <SegmentedControl options={VIEWS} value={view} onChange={setView} />
      {view === 'second_hand' ? (
        <EmptyState
          title="Pre-loved from other people"
          body="Soon you can sell pieces you don’t wear and find second-hand clothes that fit your wardrobe."
        />
      ) : (
        <ShopView />
      )}
    </Screen>
  );
}
