import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Screen, Text } from '@/ui';

type Check = 'checking' | 'ok' | 'error';

/**
 * M0 placeholder: proves the app builds, runs on web/phones and can reach Supabase.
 * Replaced by the real home screen in M1.
 */
export default function Home() {
  const [check, setCheck] = useState<Check>('checking');

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ error }) => setCheck(error ? 'error' : 'ok'))
      .catch(() => setCheck('error'));
  }, []);

  const label = { checking: 'Connecting…', ok: 'Connected to Supabase', error: 'Could not reach Supabase' }[check];

  return (
    <Screen centered>
      <Text variant="title">Areks Fashion Advice</Text>
      <Text muted>Test build (M0). Wardrobe coming next.</Text>
      <Text variant="caption" accessibilityLabel="Supabase status" tone={check === 'error' ? 'danger' : 'default'}>
        {label}
      </Text>
    </Screen>
  );
}
