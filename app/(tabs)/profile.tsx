import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useAuth } from '@/lib/auth';
import { validateDisplayName } from '@/lib/authForm';
import {
  fetchProfile,
  invokeAccountFunction,
  updateProfile,
  type Profile,
  type ProfileUpdate,
  type ShoppingPreference,
} from '@/lib/profile';
import { saveJsonFile } from '@/lib/saveFile';
import { supabase } from '@/lib/supabase';
import { Button, ChipGroup, Screen, Section, SwitchRow, Text, TextField, useTheme } from '@/ui';

const PREFERENCES = [
  { value: 'womenswear', label: 'Womenswear' },
  { value: 'menswear', label: 'Menswear' },
  { value: 'both', label: 'Both' },
] as const satisfies readonly { value: ShoppingPreference; label: string }[];

export default function ProfileScreen() {
  const t = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId)
      .then((p) => {
        if (!active) return;
        setProfile(p);
        setName(p.display_name ?? '');
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  function retry() {
    setLoadFailed(false);
    setAttempt((a) => a + 1);
  }

  async function save(update: ProfileUpdate, okText?: string) {
    if (!userId || !profile) return;
    const previous = profile;
    setProfile({ ...profile, ...update }); // optimistic
    try {
      setProfile(await updateProfile(userId, update));
      if (okText) setMessage({ text: okText, tone: 'success' });
    } catch {
      setProfile(previous);
      setMessage({ text: 'Couldn’t save that change. Please try again.', tone: 'danger' });
    }
  }

  async function saveName() {
    const error = validateDisplayName(name);
    setNameError(error);
    if (error || !profile || (profile.display_name ?? '') === name.trim()) return;
    await save({ display_name: name.trim() || null }, 'Name saved.');
  }

  async function exportData() {
    setExporting(true);
    setMessage(null);
    try {
      const data = await invokeAccountFunction<object>('account-export');
      const date = new Date().toISOString().slice(0, 10);
      await saveJsonFile(`cloey-export-${date}.json`, JSON.stringify(data, null, 2));
      setMessage({ text: 'Your data has been exported.', tone: 'success' });
    } catch {
      setMessage({ text: 'Export failed. Please try again in a moment.', tone: 'danger' });
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setMessage(null);
    try {
      await invokeAccountFunction('account-delete', { confirm: 'DELETE' });
      await supabase.auth.signOut({ scope: 'local' }); // the user no longer exists; just clear this device
    } catch {
      setDeleting(false);
      setMessage({ text: 'We couldn’t delete your account. Please try again.', tone: 'danger' });
    }
  }

  if (loadFailed) {
    return (
      <Screen centered>
        <Text>We couldn’t load your profile.</Text>
        <Button label="Try again" variant="secondary" onPress={retry} />
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen centered>
        <ActivityIndicator color={t.colours.accent} accessibilityLabel="Loading profile" />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text variant="title">Profile</Text>
      <Text muted>{session?.user.email}</Text>

      {message ? (
        <Text tone={message.tone} accessibilityLiveRegion="polite">
          {message.text}
        </Text>
      ) : null}

      <Section title="About you">
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          onBlur={saveName}
          onSubmitEditing={saveName}
          error={nameError}
          autoComplete="name"
          returnKeyType="done"
        />
        <Text variant="label">Shop suggestions from</Text>
        <ChipGroup
          options={PREFERENCES}
          value={profile.shopping_preference}
          onChange={(v) => save({ shopping_preference: v })}
        />
        <Text variant="caption" muted>
          Only used to filter shop results. Leave empty to see everything.
        </Text>
      </Section>

      <Section title="Privacy">
        <SwitchRow
          label="Let AI see faces in my photos"
          description="Off: faces are blurred before any photo is analysed. On: slightly better outfit analysis for mirror selfies."
          value={profile.consent_face_analysis}
          onChange={(v) => save({ consent_face_analysis: v })}
        />
      </Section>

      <Section title="Your data">
        <Text variant="caption" muted>
          Download everything Cloey stores about you as a file.
        </Text>
        <Button label="Export my data" variant="secondary" onPress={exportData} loading={exporting} />

        {confirmDelete ? (
          <>
            <Text tone="danger">
              This permanently deletes your account, wardrobe, outfits and photos. It can’t be undone.
            </Text>
            <Button label="Yes, delete everything" variant="danger" onPress={deleteAccount} loading={deleting} />
            <Button label="Cancel" variant="secondary" onPress={() => setConfirmDelete(false)} disabled={deleting} />
          </>
        ) : (
          <Button label="Delete my account" variant="secondary" onPress={() => setConfirmDelete(true)} />
        )}
      </Section>

      <Button label="Sign out" variant="secondary" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
