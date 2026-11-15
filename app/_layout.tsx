import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useTheme } from '@/ui';

function RootNavigator() {
  const { session, loading, recovering } = useAuth();
  const t = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colours.background }}>
        <ActivityIndicator color={t.colours.accent} accessibilityLabel="Loading" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colours.background } }}>
      <Stack.Protected guard={!!session && !recovering}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="confirm-tags" options={{ presentation: 'fullScreenModal' }} />
      </Stack.Protected>
      {/* Signed in through a password-reset link: set a new password before entering the app. */}
      <Stack.Protected guard={!!session && recovering}>
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <AuthProvider>
      <RootNavigator />
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
    </AuthProvider>
  );
}
