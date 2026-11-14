import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TypeVariant } from './tokens';
import { useTheme } from './theme';

type AppTextProps = TextProps & { variant?: TypeVariant; muted?: boolean; tone?: 'default' | 'danger' | 'success' };

/** All text goes through this, so type scale and colours stay consistent. */
export function Text({ variant = 'body', muted, tone = 'default', style, ...rest }: AppTextProps) {
  const t = useTheme();
  const colour = tone === 'danger' ? t.colours.danger : tone === 'success' ? t.colours.success : muted ? t.colours.textMuted : t.colours.text;
  return <RNText {...rest} style={[t.typography[variant], { color: colour }, style]} />;
}

/** Page wrapper: background, safe areas, standard padding. */
export function Screen({ children, scroll = false, centered = false }: { children: ReactNode; scroll?: boolean; centered?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + t.space.lg,
    paddingBottom: insets.bottom + t.space.lg,
    paddingHorizontal: t.space.lg,
    gap: t.space.md,
  };
  const content = [padding, centered && styles.centered];
  return scroll ? (
    <ScrollView style={{ backgroundColor: t.colours.background }} contentContainerStyle={content}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, { backgroundColor: t.colours.background }, content]}>{children}</View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
};

/** Primary = the one main action on a screen. Secondary = everything else. Danger = confirming a destructive action. */
export function Button({ label, onPress, variant = 'primary', disabled, loading }: ButtonProps) {
  const t = useTheme();
  const filled = variant !== 'secondary';
  const fill = variant === 'danger' ? t.colours.danger : t.colours.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: t.touchTarget,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.space.xl,
          backgroundColor: filled ? fill : 'transparent',
          borderColor: filled ? fill : t.colours.borderStrong,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={filled ? t.colours.onAccent : t.colours.text} />
      ) : (
        <Text variant="label" style={{ color: filled ? t.colours.onAccent : t.colours.text }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string;
  error?: string | null;
  hint?: string;
};

/** Labelled text input with an optional hint or error underneath. */
export function TextField({ label, error, hint, ...input }: TextFieldProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: t.space.xs, alignSelf: 'stretch' }}>
      <Text variant="label">{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        placeholderTextColor={t.colours.textMuted}
        style={[
          t.typography.body,
          {
            minHeight: t.touchTarget,
            paddingHorizontal: t.space.md,
            borderRadius: t.radius.md,
            borderWidth: focused ? 2 : 1,
            borderColor: error ? t.colours.danger : focused ? t.colours.accent : t.colours.borderStrong,
            backgroundColor: t.colours.surfaceSunken,
            color: t.colours.text,
          },
        ]}
      />
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Garment colour dot. The hex is taxonomy data (src/lib/taxonomy.ts), not a UI colour, so it always sits on a
 * borderStrong ring to keep white and black visible in both modes.
 */
export function ColourSwatch({ hex, size = 16 }: { hex: string; size?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: t.colours.borderStrong,
        backgroundColor: hex,
      }}
    />
  );
}

/** Selectable pill for filters, tags and single choices. `swatch` adds a garment colour dot before the label. */
export function Chip({
  label,
  selected,
  onPress,
  swatch,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  swatch?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={(t.touchTarget - 36) / 2}
      style={{
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        paddingHorizontal: t.space.md,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: selected ? t.colours.accent : t.colours.borderStrong,
        backgroundColor: selected ? t.colours.accent : 'transparent',
      }}
    >
      {swatch ? <ColourSwatch hex={swatch} /> : null}
      <Text variant="label" style={{ color: selected ? t.colours.onAccent : t.colours.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Single-choice row of chips. `value` null = nothing selected; tapping the selected chip clears it. */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          selected={o.value === value}
          onPress={() => onChange(o.value === value ? null : o.value)}
        />
      ))}
    </View>
  );
}

/** Multi-choice row of chips (colours, seasons…). The caller decides order and limits. */
export function MultiChipGroup<T extends string>({
  options,
  values,
  onToggle,
}: {
  options: readonly { value: T; label: string; swatch?: string }[];
  values: readonly T[];
  onToggle: (value: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          swatch={o.swatch}
          selected={values.includes(o.value)}
          onPress={() => onToggle(o.value)}
        />
      ))}
    </View>
  );
}

/**
 * One AI tag field on the confirm-tags screen. `check` (low confidence) gets a dotted border and "Check this";
 * `pick` (left empty) asks the user to choose. Children are the chips.
 */
export function TagConfirmRow({
  label,
  status = 'ok',
  hint,
  children,
}: {
  label: string;
  status?: 'ok' | 'check' | 'pick';
  hint?: string;
  children: ReactNode;
}) {
  const t = useTheme();
  const flagged = status !== 'ok';
  const note = status === 'check' ? 'Check this' : status === 'pick' ? 'Please pick' : null;
  return (
    <View
      style={{
        alignSelf: 'stretch',
        gap: t.space.sm,
        padding: t.space.md,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderStyle: flagged ? 'dotted' : 'solid',
        borderColor: flagged ? t.colours.borderStrong : 'transparent',
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: t.space.sm }}>
        <Text variant="heading" accessibilityRole="header">
          {label}
        </Text>
        {note ? (
          <Text variant="label" style={{ color: t.colours.accent }}>
            {note}
          </Text>
        ) : null}
      </View>
      {hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** A setting row with a label, optional description and an on/off switch. */
export function SwitchRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: t.touchTarget }}>
      <View style={{ flex: 1, gap: t.space.xxs }}>
        <Text variant="label">{label}</Text>
        {description ? (
          <Text variant="caption" muted>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: t.colours.borderStrong, true: t.colours.accent }}
        thumbColor={t.colours.surface}
      />
    </View>
  );
}

/** Groups related content on a surface card. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        alignSelf: 'stretch',
        gap: t.space.md,
        padding: t.space.lg,
        borderRadius: t.radius.md,
        backgroundColor: t.colours.surface,
        borderWidth: 1,
        borderColor: t.colours.border,
      }}
    >
      {title ? <Text variant="heading">{title}</Text> : null}
      {children}
    </View>
  );
}

/** Calm placeholder for empty lists, with one clear next step. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ButtonProps }) {
  const t = useTheme();
  return (
    <View style={[styles.centered, { gap: t.space.sm, padding: t.space.xl }]}>
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {body ? (
        <Text muted style={styles.center}>
          {body}
        </Text>
      ) : null}
      {action ? <Button {...action} /> : null}
    </View>
  );
}

/** Garment photo in a 4:5 photo well with an optional one-line label. `uri` null shows the empty well (loading). */
export function ItemCard({ uri, label }: { uri: string | null; label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: t.space.xs }}>
      <View
        style={{
          aspectRatio: t.aspect.item,
          borderRadius: t.radius.md,
          overflow: 'hidden',
          backgroundColor: t.colours.surfaceSunken,
        }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityLabel={label ?? 'Wardrobe item'}
          />
        ) : null}
      </View>
      {label ? (
        <Text variant="caption" muted numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Grid of photos in equal columns (2 on phones, more on wide web; see gridColumns in src/lib/photo.ts). */
export function PhotoGrid<T>({
  items,
  columns,
  keyOf,
  renderItem,
}: {
  items: readonly T[];
  columns: number;
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const t = useTheme();
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return (
    <View style={{ gap: t.space.lg, alignSelf: 'stretch' }}>
      {rows.map((row) => (
        <View key={row.map(keyOf).join(':')} style={{ flexDirection: 'row', gap: t.space.md }}>
          {row.map((item) => (
            <View key={keyOf(item)} style={styles.fill}>
              {renderItem(item)}
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`spacer-${i}`} style={styles.fill} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  button: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, alignSelf: 'stretch' },
});
