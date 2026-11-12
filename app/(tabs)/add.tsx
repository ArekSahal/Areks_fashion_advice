import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Platform, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { addItemFromPhoto } from '@/lib/items';
import type { PreparedPhoto } from '@/lib/photo';
import { preparePhoto } from '@/lib/preparePhoto';
import { Button, Screen, Text, useTheme } from '@/ui';

type Step = 'idle' | 'preparing' | 'uploading';

const STEP_LABEL: Record<Step, string> = {
  idle: '',
  preparing: 'Getting your photo ready…',
  uploading: 'Adding it to your wardrobe…',
};

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };

/**
 * Add-item flow (M1c): choose a photo (library first, camera second) → resize + re-encode → upload →
 * process-image → wardrobe. Tag confirmation is added in a later step.
 * Choosing from the library never asks for camera access (issue #20).
 */
export default function Add() {
  const t = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [step, setStep] = useState<Step>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = step !== 'idle';

  async function handle(result: ImagePicker.ImagePickerResult) {
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset || !userId) return;
    setMessage(null);
    setPreview(asset.uri);
    setStep('preparing');
    let photo: PreparedPhoto;
    try {
      photo = await preparePhoto(asset);
    } catch {
      setStep('idle');
      setMessage('We couldn’t read that photo. Try a different one.');
      return;
    }
    setStep('uploading');
    try {
      await addItemFromPhoto(userId, photo);
      setStep('idle');
      setPreview(null);
      router.navigate('/');
    } catch {
      setStep('idle');
      setMessage('We couldn’t add that photo. Check your connection and try again.');
    }
  }

  async function chooseFromLibrary() {
    // The system photo picker (and the browser file chooser) needs no permission prompt.
    // On web, launch straight from the tap so the browser opens the file chooser.
    try {
      await handle(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
    } catch {
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
      await handle(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
    } catch {
      setMessage('We couldn’t open the camera. You can still choose a photo from your library.');
    }
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

      {busy ? (
        <View style={{ alignItems: 'center', gap: t.space.sm }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={t.colours.accent} />
          <Text muted>{STEP_LABEL[step]}</Text>
        </View>
      ) : null}

      {message ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}

      <Button label="Choose from library" onPress={chooseFromLibrary} disabled={busy} />
      <Button label="Take photo" variant="secondary" onPress={takePhoto} disabled={busy} />
    </Screen>
  );
}
