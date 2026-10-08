import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useIsFocused, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarSpace, useTabBarStyle } from '@/components/Menus';
import { LinearGradient } from 'expo-linear-gradient';

import { HostVerificationCard } from '@/components/HostVerificationCard';
import { FadeIn, Pop } from '@/components/Motion';
import { StateView, type ViewState } from '@/components/StateView';
import { Button, Card, Row, Screen, Text, type IconName } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { fonts, liveColors, useTheme } from '@/lib/theme';
import { CATEGORIES, categoryLabel } from '@/lib/types';

type LiveMode = 'live' | 'voice' | 'video';
const LIVE_MODES: { key: LiveMode; label: string }[] = [
  { key: 'video', label: 'Multi-guest LIVE' },
  { key: 'live', label: 'LIVE' },
  { key: 'voice', label: 'Audio LIVE' },
];

/** Icon + label button on the camera screen (Flip, Cover, Creator Center). */
function Tool({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ alignItems: 'center', gap: 6, minWidth: 72, minHeight: 44 }}>
      <Ionicons name={icon} size={30} color="#fff" />
      <Text variant="caption" color="#fff" style={{ textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

export default function CreateScreen() {
  const tabSpace = useTabBarSpace();
  const tabBarStyle = useTabBarStyle();
  const navigation = useNavigation();
  const supabase = useSupabase();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const { profile, host, isHost, error: profileError, reload: reloadProfile } = useProfile();
  const [camera, requestCamera] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  // Start from the room's last title and category until the host changes them.
  const [titleEdit, setTitle] = useState<string | null>(null);
  const [categoryEdit, setCategory] = useState<(typeof CATEGORIES)[number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Front or back camera; Flip changes it and the live broadcast uses the same one.
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  // Only hold the camera while this tab is on screen, so the broadcast can take it.
  const focused = useIsFocused();

  const room = useFocusedAsync(async () => {
    if (!profile) return null;
    const [{ data, error }, { data: setting, error: settingError }, { data: modeRow }] = await Promise.all([
      supabase.from('rooms').select('id,status,title,category,cover_url').eq('host_id', profile.id).maybeSingle(),
      supabase.from('platform_settings').select('value').eq('key', 'host_verification').maybeSingle(),
      supabase.from('rooms').select('mode').eq('host_id', profile.id).maybeSingle(),
    ]);
    // A failed load must not look like "no cover" or "not live".
    if (error) throw error;
    if (settingError) throw settingError;
    const mode = (modeRow?.mode ?? 'live') as 'live' | 'voice' | 'video';
    const verificationRequired = (setting?.value as { required_to_go_live?: boolean } | undefined)?.required_to_go_live !== false;
    return data ? { ...data, mode, verificationRequired } : { verificationRequired, mode, id: null as string | null, status: null, title: '', cover_url: null as string | null };
  }, [profile?.id, isHost]);

  const title = titleEdit ?? room.data?.title ?? '';
  const savedCategory = (room.data as { category?: string } | null | undefined)?.category;
  const category: (typeof CATEGORIES)[number] = categoryEdit
    ?? ((CATEGORIES as readonly string[]).includes(savedCategory ?? '') ? (savedCategory as (typeof CATEGORIES)[number]) : 'chat');

  // Didit results arrive as a notification; refresh the host's status when one lands.
  useRealtime('notifications', profile ? `user_id=eq.${profile.id}` : undefined, (p) => {
    if ((p.new as { type?: string }).type === 'verification') void reloadProfile();
  }, !!profile);

  const verification = host?.verification_status ?? 'unverified';
  // Wait for the room/settings before deciding, so the verification card doesn't flash.
  // Off by default on the hosted project: anyone can stream; the ID check is for earning (withdrawals, Host badge, agency).
  const needsVerification = !!room.data && room.data.verificationRequired !== false && verification !== 'approved';

  // Streaming needs a room and Host ID (the user's own ID), created the first time someone adds a cover or goes live.
  const ensureHost = async () => {
    if (isHost) return;
    await rpc(supabase, 'become_host');
    track('became_host', {});
    await reloadProfile();
  };

  const goLive = async () => {
    setBusy(true);
    try {
      await ensureHost();
      const live = await rpc<{ id: string; mode?: string }>(supabase, 'go_live', { p_title: title.trim() || 'Live now', p_category: category });
      track('went_live', { category });
      // Voice/video parties (chosen on the Party tab) open the party room instead of the solo live screen.
      if (live?.mode === 'voice' || live?.mode === 'video') router.push({ pathname: '/party/[roomId]', params: { roomId: live.id } });
      else router.push({ pathname: '/host/live', params: { facing } });
    } catch (e) {
      Alert.alert('Could not go live', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const endLive = async () => {
    setBusy(true);
    try {
      await rpc(supabase, 'end_live');
      room.reload();
    } catch (e) {
      Alert.alert('Could not end the live', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // LIVE (solo), Multi-guest LIVE (video party) or Audio LIVE (voice party); sticks to the room.
  const changeMode = async (next: LiveMode) => {
    setBusy(true);
    try {
      await ensureHost();
      await rpc(supabase, 'set_room_mode', { p_mode: next });
      room.reload();
    } catch (e) {
      Alert.alert('Could not switch', friendlyError(e));
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
      await ensureHost();
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

  // Voice parties publish the mic only, so they don't need the camera.
  const voiceOnly = room.data?.mode === 'voice';
  const needsPermission = Platform.OS !== 'web' && ((!voiceOnly && !camera?.granted) || !mic?.granted);
  const canAsk = (voiceOnly || camera?.canAskAgain !== false) && mic?.canAskAgain !== false;

  let state: ViewState = { kind: 'success' };
  if (!profile) {
    state = offline ? { kind: 'offline', onRetry: reloadProfile }
      : profileError ? { kind: 'error', error: profileError, onRetry: reloadProfile }
      : { kind: 'loading' };
  }
  else if (profile.status !== 'active') state = { kind: 'disabled', title: 'Going live is paused', body: 'Your account is currently restricted. Check Messages for details.' };
  else if (host && host.status !== 'active') state = { kind: 'disabled', title: 'Hosting suspended', body: 'Contact support or your agency for details.' };
  // Permissions matter only for starting a live: a host who is already live always reaches End live.
  else if (!needsVerification && room.data && room.data.status !== 'live' && needsPermission && canAsk) {
    state = {
      kind: 'permission',
      title: voiceOnly ? 'Microphone' : 'Camera & microphone',
      body: voiceOnly ? 'Zynalive needs your microphone for a voice party.' : 'Zynalive needs your camera and microphone to broadcast.',
      onGrant: async () => {
        if (!voiceOnly) await requestCamera();
        await requestMic();
      },
    };
  } else if (!needsVerification && room.data && room.data.status !== 'live' && needsPermission) {
    state = {
      kind: 'permission',
      title: 'Permissions blocked',
      body: voiceOnly ? 'Turn on the microphone for Zynalive in your phone settings.' : 'Turn on the camera and microphone for Zynalive in your phone settings.',
      grantTitle: 'Open settings',
      onGrant: () => void Linking.openSettings(),
    };
  }

  if (state.kind === 'success' && !needsVerification && !room.data) {
    state = room.error ? { kind: 'error', error: room.error, onRetry: room.reload } : { kind: 'loading' };
  }
  const ready = !needsVerification && !!room.data && room.data.status !== 'live';
  const lc = liveColors;

  // The camera screen is full screen like other live apps: no tab bar, a close button instead.
  const fullScreen = state.kind === 'success' && ready;
  const tabBarStyleRef = useRef(tabBarStyle);
  useEffect(() => { tabBarStyleRef.current = tabBarStyle; });
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: fullScreen ? { display: 'none' } : tabBarStyleRef.current });
  }, [navigation, fullScreen]);

  if (state.kind === 'success' && ready) {
    const mode = room.data?.mode ?? 'live';
    return (
      <View style={{ flex: 1, backgroundColor: '#0B0612' }}>
        {focused && <StatusBar style="light" />}
        {Platform.OS !== 'web' && focused && !voiceOnly && camera?.granted ? (
          <CameraView facing={facing === 'environment' ? 'back' : 'front'} style={StyleSheet.absoluteFill} />
        ) : (
          <LinearGradient colors={['#1A0F2E', '#0B0612']} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 10 }]}>
            <Ionicons name={voiceOnly ? 'mic' : 'videocam-outline'} size={40} color="rgba(255,255,255,0.3)" />
            <Text variant="caption" color="rgba(255,255,255,0.4)" style={{ letterSpacing: 1 }}>{voiceOnly ? 'AUDIO LIVE · VOICE ONLY' : 'CAMERA PREVIEW'}</Text>
          </LinearGradient>
        )}
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, justifyContent: 'space-between' }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 12 }}>
            <Row style={{ justifyContent: 'flex-end' }}>
              <Pressable onPress={() => router.navigate('/')} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={{ padding: 4 }}>
                <Ionicons name="close" size={32} color="#fff" />
              </Pressable>
            </Row>
            <View style={{ borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(20,16,26,0.82)', padding: 12, gap: 12 }}>
              <Row gap={12}>
                <Pressable onPress={pickCover} disabled={uploading || offline} accessibilityRole="button" accessibilityLabel={cover ? 'Edit cover picture' : 'Add cover picture, required'}
                  style={{ width: 76, height: 76, borderRadius: 14, overflow: 'hidden', backgroundColor: lc.surfaceRaised, alignItems: 'center', justifyContent: 'center', borderWidth: cover ? 0 : 2, borderStyle: 'dashed', borderColor: lc.accent }}>
                  {cover ? (
                    <Pop key={cover} from={0.7}><Image source={cover} style={{ width: 76, height: 76 }} contentFit="cover" /></Pop>
                  ) : (
                    <Ionicons name={uploading ? 'cloud-upload-outline' : 'image-outline'} size={26} color={lc.accent} />
                  )}
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center' }}>
                    <Text variant="caption" color="#fff" style={{ fontWeight: '700' }}>{uploading ? '…' : cover ? 'Edit' : 'Add cover'}</Text>
                  </View>
                </Pressable>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Add a title to chat"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  maxLength={80}
                  accessibilityLabel="Stream title"
                  style={{ flex: 1, color: '#fff', fontFamily: fonts.bold, fontSize: 20, minHeight: 48 }}
                />
              </Row>
              <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {CATEGORIES.map((cat) => {
                  const on = category === cat;
                  return (
                    <Pressable key={cat} onPress={() => setCategory(cat)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Category ${categoryLabel(cat)}`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: 20, backgroundColor: on ? lc.accent : 'rgba(255,255,255,0.1)' }}>
                      <Text color="#fff" style={{ fontWeight: '700' }}>#</Text>
                      <Text color="#fff">{categoryLabel(cat)}</Text>
                      <Ionicons name={on ? 'checkmark' : 'add'} size={16} color="#fff" />
                    </Pressable>
                  );
                })}
              </ScrollView>
              {!cover && <Text variant="caption" color={lc.accent}>Add a cover picture to go live. It shows on Home and in search.</Text>}
            </View>
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 18 }}>
            <Row style={{ justifyContent: 'space-evenly' }}>
              {!voiceOnly && <Tool icon="camera-reverse-outline" label="Flip" onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} />}
              <Tool icon="image-outline" label="Cover" onPress={pickCover} />
              {isHost && <Tool icon="stats-chart-outline" label="Creator Center" onPress={() => router.push('/host/dashboard')} />}
            </Row>
            <Button
              title={cover ? 'Go LIVE' : 'Add a cover to go live'}
              onPress={goLive}
              loading={busy}
              disabled={offline || !cover || uploading}
              style={{ minHeight: 60, borderRadius: 30 }}
            />
            {offline && <Text variant="bodySmall" color={lc.textMuted} style={{ textAlign: 'center', marginTop: -8 }}>You need a connection to go live.</Text>}
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', justifyContent: 'center', gap: 22 }}>
              {LIVE_MODES.map((m) => {
                const on = mode === m.key;
                return (
                  <Pressable key={m.key} onPress={() => void changeMode(m.key)} disabled={busy || on} accessibilityRole="tab" accessibilityState={{ selected: on }} hitSlop={8} style={{ alignItems: 'center', gap: 6, minHeight: 44, justifyContent: 'center' }}>
                    <Text color={on ? '#fff' : 'rgba(255,255,255,0.55)'} style={{ fontWeight: '700', fontSize: on ? 17 : 15 }}>{m.label}</Text>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: on ? '#fff' : 'transparent' }} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <Screen>
      <StateView state={state}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: tabSpace + 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <FadeIn style={{ borderRadius: 22, overflow: 'hidden' }}>
            <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 20, gap: 6 }}>
              <Row gap={8}>
                <Ionicons name="videocam" size={22} color="#fff" />
                <Text variant="h1" color="#fff">Go live</Text>
              </Row>
              <Text color="rgba(255,255,255,0.85)">
                {needsVerification ? 'Finish verification to unlock streaming.' : `You're live now.`}
              </Text>
            </LinearGradient>
          </FadeIn>

          {needsVerification ? (
            <FadeIn delay={80}><HostVerificationCard status={verification} onChanged={() => void reloadProfile()} /></FadeIn>
          ) : (
            <FadeIn delay={80}>
            <Card style={{ gap: 12 }}>
              <Row gap={10}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: `${c.success}22`, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="radio" size={16} color={c.success} />
                </View>
                <Text variant="h3">{"You're live"}</Text>
              </Row>
              <Text muted>{room.data?.title}</Text>
              <Button
                title="Return to stream"
                onPress={() => (room.data?.mode !== 'live' && room.data?.id
                  ? router.push({ pathname: '/party/[roomId]', params: { roomId: room.data.id } })
                  : router.push('/host/live'))}
              />
              {/* Always reachable, even when the live screen can't connect. */}
              <Button title="End live" variant="ghost" loading={busy} onPress={() => confirmAction('End your live?', 'Everyone watching will be disconnected.', 'End live', () => void endLive())} />
            </Card>
            </FadeIn>
          )}
        </ScrollView>
      </StateView>
    </Screen>
  );
}
