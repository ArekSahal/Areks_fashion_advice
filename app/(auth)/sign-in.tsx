import { Link } from 'expo-router';
import { useState } from 'react';
import { friendlyAuthError, validateEmail, validatePassword } from '@/lib/authForm';
import { supabase } from '@/lib/supabase';
import { Button, Screen, Text, TextField, useTheme } from '@/ui';

export default function SignIn() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null; form?: string | null }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next = { email: validateEmail(email), password: validatePassword(password, 'sign-in') };
    setErrors(next);
    if (next.email || next.password) return;

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    // On success the auth listener switches to the app; nothing else to do here.
    if (error) setErrors({ form: friendlyAuthError(error) });
  }

  return (
    <Screen scroll centered>
      <Text variant="display">Cloey</Text>
      <Text muted style={{ textAlign: 'center', marginBottom: t.space.lg }}>
        Your wardrobe, your outfits, your style.
      </Text>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {errors.form ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {errors.form}
        </Text>
      ) : null}

      <Button label="Sign in" onPress={submit} loading={busy} />

      <Link href="/sign-up" replace style={{ marginTop: t.space.md }}>
        <Text variant="label" muted>
          New to Cloey? <Text variant="label">Create an account</Text>
        </Text>
      </Link>
    </Screen>
  );
}
