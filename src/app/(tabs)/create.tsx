import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { router, useIsFocused } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HostVerificationCard } from '@/components/HostVerificationCard';
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
  // Only hold the camera while this tab is on screen, so the broadcast can take it.
  const focused = useIsFocused();

  const room = useFocusedAsync(async () => {
    if (!profile) return null;
    const [{ data }, { data: setting }] = await Promise.all([
      supabase.from('rooms').select('id,status,title,category').eq('host_id', profile.id).maybeSingle(),
      supabase.from('platform_settings').select('value').eq('key', 'host_verification').maybeSingle(),
    ]);
    const verificationRequired = (setting?.value as { required_to_go_live?: boolean } | undefined)?.required_to_go_live !== false;
    return data ? { ...data, verificationRequired } : { verificationRequired, status: null, title: '' };
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
      <View style={{ flex: 1, backgroundColor: '#2A2436' }}>
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
            title="Go live"
            onPress={goLive}
            loading={busy}
            disabled={offline}
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
              <Text muted>{"Stream to your followers, receive gifts, and earn 90% of every gift's coins. You'll get a permanent Host ID."}</Text>
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
