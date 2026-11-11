import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTheme } from '@/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(name: IconName, focusedName: IconName) {
  function TabIcon({ color, size, focused }: { color: string; size: number; focused: boolean }) {
    return <Ionicons name={focused ? focusedName : name} size={size} color={color} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colours.accent,
        tabBarInactiveTintColor: t.colours.textMuted,
        tabBarStyle: { backgroundColor: t.colours.surface, borderTopColor: t.colours.border },
        tabBarLabelStyle: { fontSize: t.typography.caption.fontSize },
        sceneStyle: { backgroundColor: t.colours.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Wardrobe', tabBarIcon: icon('shirt-outline', 'shirt') }} />
      <Tabs.Screen name="diary" options={{ title: 'Diary', tabBarIcon: icon('calendar-outline', 'calendar') }} />
      <Tabs.Screen name="add" options={{ title: 'Add', tabBarIcon: icon('add-circle-outline', 'add-circle') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
