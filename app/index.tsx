import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { supabase } from '@/lib/supabase';

type Check = 'checking' | 'ok' | 'error';

/**
 * M0 placeholder: proves the app builds, runs on web/phones and can reach Supabase.
 * Replaced by the real home screen once the UX design system lands.
 */
export default function Home() {
  const dark = useColorScheme() === 'dark';
  const [check, setCheck] = useState<Check>('checking');

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ error }) => setCheck(error ? 'error' : 'ok'))
      .catch(() => setCheck('error'));
  }, []);

  const fg = dark ? '#F2F0EC' : '#1C1B19';
  const label = { checking: 'Connecting…', ok: 'Connected to Supabase', error: 'Could not reach Supabase' }[check];

  return (
    <View style={[styles.root, { backgroundColor: dark ? '#141412' : '#FAF8F5' }]}>
      <Text style={[styles.title, { color: fg }]}>Areks Fashion Advice</Text>
      <Text style={[styles.body, { color: fg }]}>Test build (M0). Wardrobe coming next.</Text>
      <Text accessibilityLabel="Supabase status" style={[styles.status, { color: check === 'error' ? '#C2410C' : fg }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { fontSize: 16, opacity: 0.8 },
  status: { fontSize: 14, marginTop: 16 },
});
