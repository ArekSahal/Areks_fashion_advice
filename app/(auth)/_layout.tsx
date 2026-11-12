import { Stack } from 'expo-router';
import { useTheme } from '@/ui';

export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colours.background } }} />;
}
