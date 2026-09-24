import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';

import { HostVerificationCard } from '@/components/HostVerificationCard';
import { StateView, type ViewState } from '@/components/StateView';
import { Button, Card, Chip, Input, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';

const CATEGORIES = ['chat', 'music', 'gaming', 'talent', 'education', 'other'] as const;

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
  const verifiedBadge = verification === 'approved' ? ' · ✓ Verified' : '';
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
          ) : room.data?.status === 'live' ? (
            <Card>
              <Text variant="h3">{"You're live"}</Text>
              <Text muted>{room.data.title}</Text>
              <Button title="Return to stream" onPress={() => router.push('/host/live')} />
            </Card>
          ) : (
            <>
              <Text muted>Host ID {host?.host_code}{verifiedBadge}</Text>
              <Input label="Title" value={title} onChangeText={setTitle} placeholder="What's happening?" maxLength={80} />
              <View style={{ gap: 8 }}>
                <Text variant="label" muted>Category</Text>
                <Row gap={8} style={{ flexWrap: 'wrap' }}>
                  {CATEGORIES.map((cat) => (
                    <Chip key={cat} label={cat[0].toUpperCase() + cat.slice(1)} selected={category === cat} onPress={() => setCategory(cat)} />
                  ))}
                </Row>
              </View>
              <Button title="Go live" onPress={goLive} loading={busy} disabled={offline} />
              {offline && <Text muted>You need a connection to go live.</Text>}
            </>
          )}
        </ScrollView>
      </StateView>
    </Screen>
  );
}
