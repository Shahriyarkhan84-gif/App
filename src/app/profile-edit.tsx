import Ionicons from '@expo/vector-icons/Ionicons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';

import { PressScale } from '@/components/Motion';
import { StateView } from '@/components/StateView';
import { Avatar, Button, Input, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { env } from '@/lib/env';
import { friendlyError } from '@/lib/errors';
import { useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName as nameOf } from '@/lib/types';

export default function EditProfileScreen() {
  const { profile, error, reload } = useProfile();
  const offline = useOffline();
  // The form is seeded from the profile, so it only mounts once the profile has loaded —
  // otherwise Save could overwrite the real name/bio with empty fields.
  if (!profile) return <Screen edges={['bottom']}><StateView state={offline ? { kind: 'offline', onRetry: reload } : error ? { kind: 'error', error, onRetry: reload } : { kind: 'loading' }} /></Screen>;
  return <EditProfileForm key={profile.id} />;
}

function EditProfileForm() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const { profile, reload } = useProfile();
  const offline = useOffline();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [country, setCountry] = useState(profile?.country ?? '');
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameValid = !username || /^[a-z0-9_.]{3,24}$/.test(username);
  const countryValid = !country || /^[A-Z]{2}$/.test(country);

  // Photos go to avatars/<your id>/ (storage policy: own folder only), resized to 512px.
  const changePhoto = async () => {
    if (!profile) return;
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    } catch {
      // Older phones ask for photo access; if it was refused, say how to allow it.
      Alert.alert('Photo access is off', 'Allow Zynalive to use your photos in your phone\'s settings, then try again.', [
        { text: 'Not now', style: 'cancel' },
        ...(Platform.OS === 'web' ? [] : [{ text: 'Open settings', onPress: () => void Linking.openSettings() }]),
      ]);
      return;
    }
    if (picked.canceled || !picked.assets[0]) return;
    setUploading(true);
    try {
      const ref = await ImageManipulator.manipulate(picked.assets[0].uri).resize({ width: 512 }).renderAsync();
      const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      const body = await (await fetch(out.uri)).arrayBuffer();
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, body, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      // The server checks the picture is in your own folder and sets the public address (set_avatar).
      // Until 20261019010000_bug_fixes.sql is applied the function doesn't exist yet: write the
      // address directly as before (that column grant is removed by the same migration).
      const { data: saved, error: rpcErr } = await supabase.rpc('set_avatar', { p_path: path });
      let url = (saved as { avatar_url?: string | null } | null)?.avatar_url ?? null;
      if (rpcErr) {
        if (rpcErr.code !== 'PGRST202') throw new Error(rpcErr.message);
        url = `${env.supabaseUrl}/storage/v1/object/public/avatars/${path}`;
        const { error: saveErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id);
        if (saveErr) throw saveErr;
      }
      setAvatar(url);
      await reload();
    } catch (e) {
      Alert.alert('Could not change photo', friendlyError(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    // Only public fields are writable (column grants); role/status cannot be sent.
    const { error } = await supabase.from('profiles').update({
      display_name: displayName.trim() || null,
      username: username || null,
      bio: bio.trim() || null,
      country: country || null,
    }).eq('id', profile.id);
    setSaving(false);
    if (error) {
      setError(error.code === '23505' ? 'That username is taken.' : 'Could not save your profile.');
      return;
    }
    await reload();
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <PressScale onPress={changePhoto} disabled={uploading || offline} accessibilityRole="button" accessibilityLabel="Change photo" scaleTo={0.95}>
            <Avatar uri={avatar} name={nameOf(profile)} size={96} ring={c.primary} />
            <View style={{ position: 'absolute', right: 0, bottom: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: c.primary, borderWidth: 2, borderColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="camera" size={16} color={c.primaryText} />
            </View>
          </PressScale>
          <Button title={uploading ? 'Uploading…' : 'Change photo'} variant="ghost" size="sm" loading={uploading} disabled={offline} onPress={changePhoto} />
        </View>
        <Input label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={50} />
        <Input label="Username" value={username} onChangeText={(t) => setUsername(t.toLowerCase())} autoCapitalize="none" error={usernameValid ? (error === 'That username is taken.' ? error : null) : '3–24 letters, numbers, _ or .'} />
        <Input label="Bio" value={bio} onChangeText={setBio} maxLength={280} multiline style={{ minHeight: 80, paddingTop: 12 }} />
        <Input label="Country code" value={country} onChangeText={(t) => setCountry(t.toUpperCase().slice(0, 2))} placeholder="PK" autoCapitalize="characters" error={countryValid ? null : 'Two-letter code, e.g. PK, IN, BD'} />
        {offline && <Text variant="bodySmall" muted accessibilityRole="alert">You&apos;re offline. Connect to save changes.</Text>}
        {error && error !== 'That username is taken.' && <Text color={c.danger} accessibilityRole="alert">{error}</Text>}
        {/* Saving closes the screen, so wait for a photo upload to finish first. */}
        <Button title="Save" onPress={save} loading={saving} disabled={!usernameValid || !countryValid || uploading || offline} />
        <Text variant="caption" faint style={{ textAlign: 'center' }}>Your photo, name and bio are public.</Text>
      </ScrollView>
    </Screen>
  );
}
