import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, View, type TextProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TypeVariant } from './tokens';
import { useTheme } from './theme';

type AppTextProps = TextProps & { variant?: TypeVariant; muted?: boolean; tone?: 'default' | 'danger' | 'success' };

/** All text goes through this, so type scale and colours stay consistent. */
export function Text({ variant = 'body', muted, tone = 'default', style, ...rest }: AppTextProps) {
  const t = useTheme();
  const colour = tone === 'danger' ? t.colours.danger : tone === 'success' ? t.colours.success : muted ? t.colours.textMuted : t.colours.text;
  return <RNText {...rest} style={[t.type[variant], { color: colour }, style]} />;
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
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
};

/** Primary = the one main action on a screen. Secondary = everything else. */
export function Button({ label, onPress, variant = 'primary', disabled, loading }: ButtonProps) {
  const t = useTheme();
  const primary = variant === 'primary';
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
          backgroundColor: primary ? t.colours.accent : 'transparent',
          borderColor: primary ? t.colours.accent : t.colours.border,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? t.colours.onAccent : t.colours.text} />
      ) : (
        <Text variant="label" style={{ color: primary ? t.colours.onAccent : t.colours.text }}>
          {label}
        </Text>
      )}
    </Pressable>
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  button: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, alignSelf: 'stretch' },
});
