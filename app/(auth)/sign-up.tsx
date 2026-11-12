import { Link } from 'expo-router';
import { useState } from 'react';
import { friendlyAuthError, validateDisplayName, validateEmail, validatePassword } from '@/lib/authForm';
import { authRedirectUrl } from '@/lib/redirect';
import { supabase } from '@/lib/supabase';
import { Button, EmptyState, Screen, Text, TextField, useTheme } from '@/ui';

type Errors = { name?: string | null; email?: string | null; password?: string | null; form?: string | null };

export default function SignUp() {
  const t = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [checkInbox, setCheckInbox] = useState(false);

  async function submit() {
    const next: Errors = {
      name: validateDisplayName(name),
      email: validateEmail(email),
      password: validatePassword(password, 'sign-up'),
    };
    setErrors(next);
    if (next.name || next.email || next.password) return;

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: name.trim() || undefined },
        emailRedirectTo: authRedirectUrl(),
      },
    });
    setBusy(false);

    if (error) {
      setErrors({ form: friendlyAuthError(error) });
      return;
    }
    // With email confirmation on, there is no session yet: ask the user to confirm.
    // Without it, the auth listener signs them straight in.
    if (!data.session) setCheckInbox(true);
  }

  if (checkInbox) {
    return (
      <Screen centered>
        <EmptyState
          title="Check your inbox"
          body={`We sent a link to ${email.trim()}. Open it on this device to finish creating your account.`}
        />
        <Link href="/sign-in" replace>
          <Text variant="label">Back to sign in</Text>
        </Link>
      </Screen>
    );
  }

  return (
    <Screen scroll centered>
      <Text variant="title">Create your account</Text>
      <Text muted style={{ textAlign: 'center', marginBottom: t.space.lg }}>
        Start by adding a few clothes. Cloey learns your style from there.
      </Text>

      <TextField
        label="Name (optional)"
        value={name}
        onChangeText={setName}
        error={errors.name}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
      />
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
        hint="At least 8 characters."
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {errors.form ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {errors.form}
        </Text>
      ) : null}

      <Button label="Create account" onPress={submit} loading={busy} />

      <Text variant="caption" muted style={{ textAlign: 'center' }}>
        Your photos and wardrobe are private. You can export or delete everything at any time.
      </Text>

      <Link href="/sign-in" replace style={{ marginTop: t.space.md }}>
        <Text variant="label" muted>
          Already have an account? <Text variant="label">Sign in</Text>
        </Text>
      </Link>
    </Screen>
  );
}
