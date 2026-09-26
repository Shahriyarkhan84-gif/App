import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useIsFocused } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HostVerificationCard } from '@/components/HostVerificationCard';
import { Pop } from '@/components/Motion';
import { StateView, type ViewState } from '@/components/StateView';
import { Button, Card, Chip, Input, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { liveColors } from '@/lib/theme';
import { CATEGORIES, categoryLabel } from '@/lib/types';

export default function CreateScreen() {
  const supabase = useSupabase();
  const track = useAnalytics();
  const offline = useOffline();
  const { profile, host, isHost, reload: reloadProfile } = useProfile();
  const [camera, requestCamera] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('chat');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Only hold the camera while this tab is on screen, so the broadcast can take it.
  const focused = useIsFocused();

  const room = useFocusedAsync(async () => {
    if (!profile) return null;
    const [{ data }, { data: setting }] = await Promise.all([
      supabase.from('rooms').select('id,status,title,category,cover_url').eq('host_id', profile.id).maybeSingle(),
      supabase.from('platform_settings').select('value').eq('key', 'host_verification').maybeSingle(),
    ]);
    const verificationRequired = (setting?.value as { required_to_go_live?: boolean } | undefined)?.required_to_go_live !== false;
    return data ? { ...data, verificationRequired } : { verificationRequired, status: null, title: '', cover_url: null as string | null };
  }, [profile?.id, isHost]);

  // Didit results arrive as a notification; refresh the host's status when one lands.
  useRealtime('notifications', profile ? `user_id=eq.${profile.id}` : undefined, (p) => {
    if ((p.new as { type?: string }).type === 'verification') void reloadProfile();
  }, !!profile);

  const verification = host?.verification_status ?? 'unverified';
  const needsVerification = isHost && room.data?.verificationRequired !== false && verification !== 'approved';

  const becomeHost = async () => {
    setBusy(true);
    try {
      await rpc(supabase, 'become_host');
      track('became_host', {});
      await reloadProfile();
      room.reload();
    } catch (e) {
      Alert.alert('Could not continue', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const goLive = async () => {
    setBusy(true);
    try {
      await rpc(supabase, 'go_live', { p_title: title.trim() || 'Live now', p_category: category });
      track('went_live', { category });
      router.push('/host/live');
    } catch (e) {
      Alert.alert('Could not go live', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // Covers are required to go live: uploaded to covers/<user id>/ and attached by set_room_cover().
  const pickCover = async () => {
    if (!profile) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    setUploading(true);
    try {
      const ref = await ImageManipulator.manipulate(picked.assets[0].uri).resize({ width: 900 }).renderAsync();
      const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      const body = await (await fetch(out.uri)).arrayBuffer();
      const path = `${profile.id}/cover-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('covers').upload(path, body, { contentType: 'image/jpeg' });
      if (error) throw error;
      await rpc(supabase, 'set_room_cover', { p_path: path });
      track('cover_set', {});
      room.reload();
    } catch (e) {
      Alert.alert('Could not add cover', friendlyError(e));
    } finally {
      setUploading(false);
    }
  };
  const cover = room.data?.cover_url ?? null;

  const needsPermission = Platform.OS !== 'web' && (!camera?.granted || !mic?.granted);

  let state: ViewState = { kind: 'success' };
  if (!profile) state = offline ? { kind: 'offline', onRetry: reloadProfile } : { kind: 'loading' };
  else if (profile.status !== 'active') state = { kind: 'disabled', title: 'Going live is paused', body: 'Your account is currently restricted. Check Messages for details.' };
  else if (host && host.status !== 'active') state = { kind: 'disabled', title: 'Hosting suspended', body: 'Contact support or your agency for details.' };
  else if (isHost && !needsVerification && needsPermission && (camera?.canAskAgain !== false || mic?.canAskAgain !== false)) {
    state = {
      kind: 'permission',
      title: 'Camera & microphone',
      body: 'Zynalive needs your camera and microphone to broadcast.',
      onGrant: async () => {
        await requestCamera();
        await requestMic();
      },
    };
  } else if (isHost && !needsVerification && needsPermission) {
    state = { kind: 'disabled', title: 'Permissions blocked', body: 'Enable camera and microphone for Zynalive in your device settings.' };
  }

  if (state.kind === 'success' && isHost && !needsVerification && !room.data) {
    state = room.error ? { kind: 'error', error: room.error, onRetry: room.reload } : { kind: 'loading' };
  }
  const ready = isHost && !needsVerification && !!room.data && room.data.status !== 'live';
  const lc = liveColors;

  if (state.kind === 'success' && ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#170B2E' }}>
        {Platform.OS !== 'web' && focused && camera?.granted ? (
          <CameraView facing="front" style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text variant="caption" color="rgba(255,255,255,0.35)" style={{ letterSpacing: 1 }}>CAMERA PREVIEW</Text>
          </View>
        )}
        <SafeAreaView edges={['top']} style={{ padding: 12 }}>
          <View style={{ padding: 14, borderRadius: 18, backgroundColor: 'rgba(14,13,18,0.78)', gap: 14 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="h2" color={lc.text}>Go live</Text>
              <Text variant="caption" color={lc.textMuted}>ID {profile?.user_number}{verification === 'approved' ? ' · Verified' : ''}</Text>
            </Row>
            <Pressable onPress={pickCover} disabled={uploading || offline} accessibilityRole="button" accessibilityLabel={cover ? 'Change cover picture' : 'Add cover picture, required'} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ width: 72, height: 96, borderRadius: 12, overflow: 'hidden', borderWidth: cover ? 0 : 2, borderStyle: 'dashed', borderColor: lc.accent, backgroundColor: lc.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                {cover ? (
                  <Pop key={cover} from={0.7}><Image source={cover} style={{ width: 72, height: 96 }} contentFit="cover" /></Pop>
                ) : (
                  <Ionicons name={uploading ? 'cloud-upload-outline' : 'image-outline'} size={26} color={lc.accent} />
                )}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Row gap={6}>
                  <Text variant="label" color={lc.text}>Cover picture</Text>
                  {!cover && <Text variant="caption" color={lc.accent} style={{ fontWeight: '700' }}>Required</Text>}
                </Row>
                <Text variant="caption" color={lc.textMuted}>{uploading ? 'Uploading…' : cover ? 'Shown on Home and in search. Tap to change.' : 'Add a cover to go live. It shows on Home and in search.'}</Text>
              </View>
              <Ionicons name={cover ? 'create-outline' : 'add-circle'} size={22} color={cover ? lc.textMuted : lc.accent} />
            </Pressable>
            <Input label="Stream title" value={title} onChangeText={setTitle} placeholder="What are you streaming?" maxLength={80} style={{ backgroundColor: lc.surfaceRaised, borderColor: '#3A3547', color: lc.text, minHeight: 44 }} />
            <View style={{ gap: 8 }}>
              <Text variant="bodySmall" color={lc.textMuted}>Category</Text>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>
                {CATEGORIES.map((cat) => <Chip key={cat} label={categoryLabel(cat)} selected={category === cat} onPress={() => setCategory(cat)} />)}
              </Row>
            </View>
          </View>
        </SafeAreaView>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: lc.tabBar, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 20, gap: 10 }}>
          <Button
            title={cover ? 'Go live' : 'Add a cover to go live'}
            onPress={goLive}
            loading={busy}
            disabled={offline || !cover || uploading}
            icon={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' }} />}
          />
          {offline && <Text variant="bodySmall" color={lc.textMuted} style={{ textAlign: 'center' }}>You need a connection to go live.</Text>}
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <StateView state={state}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <Text variant="h1">Go live</Text>
          {!isHost ? (
            <Card>
              <Text variant="h3">Become a host</Text>
              <Text muted>{`Stream to your followers, receive gifts, and earn 90% of every gift's coins. Your ID ${profile?.user_number ?? ''} stays the same — it's also your Host ID.`}</Text>
              <Button title="Become a host" onPress={becomeHost} loading={busy} disabled={offline} />
            </Card>
          ) : needsVerification ? (
            <HostVerificationCard status={verification} onChanged={() => void reloadProfile()} />
          ) : (
            <Card>
              <Text variant="h3">{"You're live"}</Text>
              <Text muted>{room.data?.title}</Text>
              <Button title="Return to stream" onPress={() => router.push('/host/live')} />
            </Card>
          )}
        </ScrollView>
      </StateView>
    </Screen>
  );
}
