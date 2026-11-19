import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { gridColumns } from '@/lib/photo';
import {
  MAX_QUERY_LENGTH,
  SHOP_CATEGORIES,
  SHOP_CATEGORY_LABELS,
  SHOP_GENDER_LABELS,
  SHOP_GENDERS,
  SHOP_MAX_PRICES,
  formatPrice,
  type ShopCategory,
  type ShopGender,
  type ShopMaxPrice,
  type ShopProduct,
} from '@/lib/shop';
import { fetchOfferUrl, freshOfferUrl, searchShop, type ShopResults } from '@/lib/shopClient';
import { Button, Chip, ChipGroup, EmptyState, ItemCard, PhotoGrid, Text, TextField } from './components';
import { useTheme } from './theme';

const CATEGORY_OPTIONS = SHOP_CATEGORIES.map((c) => ({ value: c, label: SHOP_CATEGORY_LABELS[c] }));
const GENDER_OPTIONS = SHOP_GENDERS.map((g) => ({ value: g, label: SHOP_GENDER_LABELS[g] }));
const SKELETON = ['a', 'b', 'c', 'd'];
/** Required label on every shop link (docs/channel3.md → Ranking and labelling). */
const COMMISSION_LABEL = 'Shop link · we may earn a commission';
/** EU fallback cards (docs/channel3.md → M1.5): priced in EUR, delivery to Sweden not verified by Channel3. */
const EU_LABEL = 'EU shop · price in €';
const EU_NOTE = 'EU shops may not deliver to Sweden. Check delivery on the shop’s site before you buy.';
const PRICE_OPTIONS = SHOP_MAX_PRICES.map((p) => ({ value: String(p) as `${ShopMaxPrice}`, label: `Under ${formatPrice(p, 'SEK')}` }));

/** One shop result: product photo, title, brand, price and whether the offer is second-hand. */
function ProductCard({ product, onOpen }: { product: ShopProduct; onOpen: () => void }) {
  const t = useTheme();
  const offer = product.offer;
  const used = offer?.condition === 'used';
  const eu = product.region === 'EU';
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${product.title}${offer ? `, ${formatPrice(offer.price, offer.currency)}` : ''}${used ? ', second-hand' : ''}${eu ? ', EU shop' : ''}. Opens the shop`}
      onPress={onOpen}
      style={{ gap: t.space.xs }}
    >
      <View
        style={{
          aspectRatio: t.aspect.item,
          borderRadius: t.radius.md,
          overflow: 'hidden',
          backgroundColor: t.colours.surface,
        }}
      >
        {product.imageUrl ? (
          <Image source={{ uri: product.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : null}
        {used ? (
          <View
            style={{
              position: 'absolute',
              top: t.space.sm,
              left: t.space.sm,
              paddingHorizontal: t.space.sm,
              paddingVertical: t.space.xxs,
              borderRadius: t.radius.pill,
              backgroundColor: t.colours.surfaceAccent,
            }}
          >
            <Text variant="caption">Second-hand</Text>
          </View>
        ) : null}
      </View>
      <Text variant="label" numberOfLines={2}>
        {product.title}
      </Text>
      {product.brand ? (
        <Text variant="caption" muted numberOfLines={1}>
          {product.brand}
        </Text>
      ) : null}
      <Text variant="caption" numberOfLines={1}>
        {offer ? `${formatPrice(offer.price, offer.currency)} · ${offer.domain}` : 'Tap to see price'}
      </Text>
      {eu ? (
        <Text variant="caption" muted numberOfLines={1}>
          {EU_LABEL}
        </Text>
      ) : null}
      <Text variant="caption" muted numberOfLines={1}>
        {COMMISSION_LABEL}
      </Text>
    </Pressable>
  );
}

/**
 * Market → Shop (M1.5, #34): search online shops through Channel3. Nothing is fetched until the user taps Search,
 * because every new search costs a Channel3 credit (docs/channel3.md). Second-hand offers come first.
 */
export function ShopView() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ShopCategory | null>(null);
  const [gender, setGender] = useState<ShopGender | null>(null);
  const [maxPrice, setMaxPrice] = useState<`${ShopMaxPrice}` | null>(null);
  const [usedOnly, setUsedOnly] = useState(false);
  const [results, setResults] = useState<ShopResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const canSearch = query.trim().length > 0 || category !== null;

  async function search() {
    if (!canSearch || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResults(
        await searchShop({
          query,
          filters: { category, gender, maxPrice: maxPrice ? (Number(maxPrice) as ShopMaxPrice) : null, usedOnly },
        }),
      );
    } catch {
      setError('The shop isn’t available right now. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }

  async function open(product: ShopProduct) {
    if (!results || opening) return;
    setError(null);
    const fresh = freshOfferUrl(product, results.fetchedAt);
    // On the web, open the tab during the tap: browsers (mobile Safari) block tabs opened after a network wait.
    const tab = !fresh && Platform.OS === 'web' ? window.open('', '_blank') : null;
    setOpening(true);
    try {
      const url = fresh ?? (await fetchOfferUrl(product));
      if (!url) {
        tab?.close();
        setError('That item is no longer available.');
      } else if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        await Linking.openURL(url);
      }
    } catch {
      tab?.close();
      setError('We couldn’t open the shop. Try again.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={{ gap: t.space.md, alignSelf: 'stretch' }}>
      <TextField
        label="What are you looking for?"
        placeholder="e.g. black wool coat"
        value={query}
        onChangeText={setQuery}
        maxLength={MAX_QUERY_LENGTH}
        returnKeyType="search"
        onSubmitEditing={search}
        autoCapitalize="none"
      />
      <ChipGroup options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
      <ChipGroup options={GENDER_OPTIONS} value={gender} onChange={setGender} />
      <ChipGroup options={PRICE_OPTIONS} value={maxPrice} onChange={setMaxPrice} />
      <View style={{ flexDirection: 'row' }}>
        <Chip label="Second-hand only" selected={usedOnly} onPress={() => setUsedOnly((v) => !v)} />
      </View>
      <Button label="Search" onPress={search} disabled={!canSearch} loading={loading} />
      {error ? (
        <Text variant="label" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {loading ? (
        <PhotoGrid items={SKELETON} columns={columns} keyOf={(k) => k} renderItem={() => <ItemCard uri={null} />} />
      ) : results === null ? (
        <EmptyState
          title="Shop online stores"
          body="Search clothes from shops that deliver to Sweden. Second-hand offers come first."
        />
      ) : results.products.length === 0 ? (
        <EmptyState title="Nothing found" body="Try fewer words or remove a filter." />
      ) : (
        <>
          <PhotoGrid
            items={results.products}
            columns={columns}
            keyOf={(p) => p.id}
            renderItem={(p) => <ProductCard product={p} onOpen={() => open(p)} />}
          />
          <Text variant="caption" muted>
            Prices and stock come from each shop and can change.
          </Text>
          {results.products.some((p) => p.region === 'EU') ? (
            <Text variant="caption" muted>
              {EU_NOTE}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
