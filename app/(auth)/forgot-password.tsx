import { Link, router } from 'expo-router';
import { useState } from 'react';
import { RESET_SENT_MESSAGE, resetRequestError, validateEmail } from '@/lib/authForm';
import { authRedirectUrl } from '@/lib/redirect';
import { supabase } from '@/lib/supabase';
import { Button, EmptyState, Screen, Text, TextField, useTheme } from '@/ui';

export default function ForgotPassword() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; form?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    const emailError = validateEmail(email);
    setErrors({ email: emailError });
    if (emailError) return;

    setBusy(true);
    // The link comes back to the app's start page; the auth listener sees the PASSWORD_RECOVERY
    // event and the root layout shows the reset screen.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl() });
    setBusy(false);

    // Same message whether or not the account exists; only show problems the user can act on.
    const formError = resetRequestError(error);
    if (formError) {
      setErrors({ form: formError });
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Screen centered>
        <EmptyState
          title="Check your inbox"
          body={`${RESET_SENT_MESSAGE} Open it on this device to choose a new password.`}
          action={{ label: 'Back to sign in', variant: 'secondary', onPress: () => router.replace('/sign-in') }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll centered>
      <Text variant="title" accessibilityRole="header">
        Forgot your password?
      </Text>
      <Text muted style={{ textAlign: 'center', marginBottom: t.space.lg }}>
        Enter your email and we’ll send you a link to choose a new one.
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
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {errors.form ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {errors.form}
        </Text>
      ) : null}

      <Button label="Send reset link" onPress={submit} loading={busy} />

      <Link href="/sign-in" replace accessibilityLabel="Remembered it? Sign in" style={{ marginTop: t.space.md }}>
        <Text variant="label" muted>
          Remembered it? <Text variant="label">Sign in</Text>
        </Text>
      </Link>
    </Screen>
  );
}
