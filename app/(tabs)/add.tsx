import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { addItemFromPhoto } from '@/lib/items';
import type { PreparedPhoto } from '@/lib/photo';
import { preparePhoto } from '@/lib/preparePhoto';
import { Button, Screen, Text, useTheme } from '@/ui';

type Step = 'idle' | 'preparing' | 'uploading';
type Source = 'library' | 'camera' | 'retry';

const STEP_LABEL: Record<Step, string> = {
  idle: '',
  preparing: 'Getting your photo ready…',
  uploading: 'Adding it to your wardrobe…',
};

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };

/**
 * Add-item flow (M1c): choose a photo (library first, camera second) → resize + re-encode → upload →
 * process-image → confirm tags (app/confirm-tags.tsx) → wardrobe.
 * Choosing from the library never asks for camera access (issue #20).
 */
export default function Add() {
  const t = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [step, setStep] = useState<Step>('idle');
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A photo that was prepared but failed to upload, so "Try again" doesn't need a new pick.
  const [pending, setPending] = useState<PreparedPhoto | null>(null);
  const busyRef = useRef(false);
  const busy = step !== 'idle';

  // Coming back to the tab starts fresh (no stale error from an earlier attempt).
  useFocusEffect(
    useCallback(() => {
      if (busyRef.current) return;
      setMessage(null);
      setPending(null);
      setPreview(null);
    }, []),
  );

  function finish(next: Step = 'idle') {
    busyRef.current = next !== 'idle';
    setStep(next);
    if (next === 'idle') setSource(null);
  }

  async function upload(photo: PreparedPhoto) {
    if (!userId) {
      setMessage('Please sign in again to add items.');
      return;
    }
    finish('uploading');
    try {
      const itemId = await addItemFromPhoto(userId, photo);
      setPending(null);
      setPreview(null);
      finish();
      router.push({ pathname: '/confirm-tags', params: { id: itemId } });
    } catch {
      setPending(photo);
      finish();
      setMessage('We couldn’t add that photo. Check your connection and try again.');
    }
  }

  async function handle(result: ImagePicker.ImagePickerResult, from: Source) {
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    if (!userId) {
      setMessage('Please sign in again to add items.');
      return;
    }
    setMessage(null);
    setPending(null);
    setPreview(asset.uri);
    setSource(from);
    finish('preparing');
    let photo: PreparedPhoto;
    try {
      photo = await preparePhoto(asset);
    } catch {
      finish();
      setMessage('We couldn’t read that photo. Try a different one.');
      return;
    }
    await upload(photo);
  }

  async function chooseFromLibrary() {
    // The system photo picker (and the browser file chooser) needs no permission prompt.
    // On web, launch straight from the tap so the browser opens the file chooser.
    try {
      await handle(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS), 'library');
    } catch {
      finish();
      setMessage('We couldn’t open your photos. Please try again.');
    }
  }

  async function takePhoto() {
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setMessage('Camera access is off. You can still choose a photo from your library.');
          return;
        }
      }
      // On web this opens the file chooser with the camera offered (capture input); no permission prompt from us.
      await handle(await ImagePicker.launchCameraAsync(PICKER_OPTIONS), 'camera');
    } catch {
      finish();
      setMessage('We couldn’t open the camera. You can still choose a photo from your library.');
    }
  }

  function retry() {
    if (!pending) return;
    setMessage(null);
    setSource('retry');
    upload(pending);
  }

  return (
    <Screen scroll>
      <Text variant="title">Add an item</Text>
      <Text muted>One piece per photo works best, laid flat or on a hanger against a plain background.</Text>

      {preview ? (
        <View
          style={{
            alignSelf: 'center',
            width: '70%',
            maxWidth: 320,
            aspectRatio: t.aspect.item,
            borderRadius: t.radius.md,
            overflow: 'hidden',
            backgroundColor: t.colours.surfaceSunken,
          }}
        >
          <Image
            source={{ uri: preview }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            accessibilityLabel="Selected photo"
          />
        </View>
      ) : null}

      <Text muted accessibilityLiveRegion="polite">
        {STEP_LABEL[step]}
      </Text>

      {message ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}

      {pending ? (
        <Button label="Try again" onPress={retry} disabled={busy} loading={busy && source === 'retry'} />
      ) : null}
      <Button
        label="Choose from library"
        variant={pending ? 'secondary' : 'primary'}
        onPress={chooseFromLibrary}
        disabled={busy}
        loading={busy && source === 'library'}
      />
      <Button
        label="Take photo"
        variant="secondary"
        onPress={takePhoto}
        disabled={busy}
        loading={busy && source === 'camera'}
      />
    </Screen>
  );
}
