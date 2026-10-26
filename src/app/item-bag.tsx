import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { FramedAvatar } from '@/components/FramedAvatar';
import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Row, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { rpc } from '@/lib/api';
import { hasFeature } from '@/lib/brand';
import { friendlyError } from '@/lib/errors';
import { useFrameCatalog } from '@/lib/frames';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

type Owned = { frame_id: string; expires_at: string | null };

function timeLeft(expiresAt: string | null) {
  if (!expiresAt) return 'Forever';
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? 'Expired' : days === 1 ? '1 day left' : `${days} days left`;
}

/** Item bag: the frames you own, how long each lasts, and wear / take off / renew. */
export default function ItemBagScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const { profile, reload: reloadProfile } = useProfile();
  const catalog = useFrameCatalog(hasFeature('frames'));
  const [busy, setBusy] = useState<string | null>(null);
  const owned = useFocusedAsync(async () => {
    if (!profile) return [] as Owned[];
    const { data, error } = await supabase.from('user_frames').select('frame_id,expires_at').eq('user_id', profile.id).order('acquired_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Owned[];
  }, [profile?.id], 'item-bag');

  const wear = async (id: string | null) => {
    setBusy(id ?? 'off');
    try {
      await rpc(supabase, 'equip_frame', { p_frame_id: id });
      await reloadProfile();
    } catch (e) {
      Alert.alert('Could not change frame', friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!hasFeature('frames')) {
    return <Screen edges={['bottom']}><StateView state={{ kind: 'disabled', title: 'Item bag is off', body: 'Items aren’t available in this app.' }} /></Screen>;
  }

  const frames = new Map((catalog.data ?? []).map((f) => [f.id, f]));
  const items = (owned.data ?? []).filter((o) => frames.has(o.frame_id));
  const wearing = profile?.active_frame_id ?? null;

  return (
    <Screen edges={['bottom']}>
      <StateView state={resolveState({
        offline, loading: owned.loading || catalog.loading, error: owned.error ?? catalog.error, data: owned.data && catalog.data ? items : undefined,
        onRetry: () => { owned.reload(); catalog.reload(); },
        isEmpty: (d) => d.length === 0,
        empty: { title: 'Your bag is empty', body: 'Frames you get show up here.', action: { title: 'Get frames', onPress: () => router.push('/frames') } },
      })}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Text variant="label" muted>FRAMES · {items.length}</Text>
          {items.map((o) => {
            const f = frames.get(o.frame_id)!;
            const left = timeLeft(o.expires_at);
            const expired = left === 'Expired';
            const on = wearing === f.id && !expired;
            return (
              <Card key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderColor: on ? c.primary : c.glassBorder }}>
                <FramedAvatar uri={profile?.avatar_url} name={displayName(profile)} size={56} frame={f} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="h3">{f.name}</Text>
                  <Text variant="caption" color={expired ? c.danger : c.textMuted}>{on ? 'Wearing · ' : ''}{left}</Text>
                </View>
                {expired ? (
                  <Button title="Renew" size="sm" onPress={() => router.push('/frames')} />
                ) : on ? (
                  <Button title="Take off" size="sm" variant="secondary" loading={busy === 'off'} disabled={offline} onPress={() => void wear(null)} />
                ) : (
                  <Button title="Wear" size="sm" loading={busy === f.id} disabled={offline} onPress={() => void wear(f.id)} />
                )}
              </Card>
            );
          })}
          <Row style={{ justifyContent: 'center', paddingTop: 4 }}>
            <Button title="Get more frames" variant="ghost" onPress={() => router.push('/frames')} />
          </Row>
        </ScrollView>
      </StateView>
    </Screen>
  );
}
