import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { friendlyAuthError, validateNewPassword } from '@/lib/authForm';
import { supabase } from '@/lib/supabase';
import { Button, Screen, Text, TextField, useTheme } from '@/ui';

type Errors = { password?: string | null; confirm?: string | null; form?: string | null };

/**
 * Shown when the user opens a password-reset link. They are signed in by the link, but the root layout
 * keeps them here (not in the tabs) until the new password is saved.
 */
export default function ResetPassword() {
  const t = useTheme();
  const { finishRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function submit() {
    const next = validateNewPassword(password, confirm);
    setErrors(next);
    if (next.password || next.confirm) return;

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setErrors({ form: friendlyAuthError(error) });
      return;
    }
    // Someone who had the old password may still be signed in elsewhere: end those sessions.
    // Best effort; the new password is already saved, so a failure here doesn't block the user.
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
    setBusy(false);
    // Saved: the root layout now lets the user into the app.
    finishRecovery();
  }

  async function cancel() {
    setLeaving(true);
    // Signing out drops the reset session; the layout then shows sign-in again.
    await supabase.auth.signOut();
    setLeaving(false);
  }

  return (
    <Screen scroll centered>
      <Text variant="title" accessibilityRole="header">
        Set a new password
      </Text>
      <Text muted style={{ textAlign: 'center', marginBottom: t.space.lg }}>
        Choose a new password for your Cloey account.
      </Text>

      <TextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        hint="At least 8 characters."
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
      />
      <TextField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
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

      <Button label="Save password" onPress={submit} loading={busy} disabled={leaving} />
      <Button label="Cancel" variant="secondary" onPress={cancel} loading={leaving} disabled={busy} />
    </Screen>
  );
}
