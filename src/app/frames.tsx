import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { FramedAvatar } from '@/components/FramedAvatar';
import { StateView, type ViewState } from '@/components/StateView';
import { Button, Coin, Row, Screen, Text } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { idempotencyKey, rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { frameDuration, useFrameCatalog, type Frame } from '@/lib/frames';
import { useAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

type Owned = { frame_id: string; expires_at: string | null };

function daysLeft(expires: string): number {
  return Math.max(0, Math.ceil((new Date(expires).getTime() - Date.now()) / 86_400_000));
}

/** Profile frame shop: preview a frame on your own photo, buy it with coins, wear or take it off. */
export default function FramesScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const { profile, reload: reloadProfile } = useProfile();
  const catalog = useFrameCatalog();
  const mine = useAsync(async () => {
    if (!profile) return null;
    const [owned, wallet] = await Promise.all([
      supabase.from('user_frames').select('frame_id,expires_at').eq('user_id', profile.id),
      supabase.from('wallets').select('coin_balance').eq('user_id', profile.id).maybeSingle(),
    ]);
    if (owned.error) throw owned.error;
    if (wallet.error) throw wallet.error;
    return { owned: (owned.data ?? []) as Owned[], balance: Number(wallet.data?.coin_balance ?? 0) };
  }, [profile?.id]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const frames = catalog.data ?? [];
  const wearing = profile?.active_frame_id ?? null;
  const selected: Frame | undefined = frames.find((f) => f.id === (picked ?? wearing)) ?? frames[0];
  const ownedRow = (id: string) => mine.data?.owned.find((o) => o.frame_id === id && (o.expires_at === null || new Date(o.expires_at) > new Date()));

  const wear = async (id: string | null) => {
    setBusy(true);
    try {
      await rpc(supabase, 'equip_frame', { p_frame_id: id });
      await reloadProfile();
    } catch (e) {
      Alert.alert('Could not change frame', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const buy = (f: Frame) => {
    const owned = ownedRow(f.id);
    confirmAction(
      owned ? `Renew ${f.name}?` : `Buy ${f.name}?`,
      `${f.coin_price.toLocaleString()} coins · ${frameDuration(f)}${owned ? ' more' : ''}. You'll wear it right away.`,
      `Pay ${f.coin_price.toLocaleString()} coins`,
      () => void (async () => {
        setBusy(true);
        try {
          // One key per tap: a network retry of this same purchase can never charge twice.
          await rpc(supabase, 'buy_frame', { p_frame_id: f.id, p_idempotency_key: idempotencyKey() });
          track('frame_bought', { frame: f.id, coins: f.coin_price });
          await rpc(supabase, 'equip_frame', { p_frame_id: f.id });
          await reloadProfile();
          mine.reload();
        } catch (e) {
          Alert.alert('Could not buy frame', friendlyError(e));
        } finally {
          setBusy(false);
        }
      })(),
    );
  };

  let state: ViewState = { kind: 'success' };
  if (offline && !catalog.data) state = { kind: 'offline', onRetry: catalog.reload };
  else if (catalog.error) state = { kind: 'error', error: catalog.error, onRetry: catalog.reload };
  else if (mine.error) state = { kind: 'error', error: mine.error, onRetry: mine.reload };
  else if (!catalog.data || !profile || !mine.data) state = { kind: 'loading' };
  else if (profile.status !== 'active') state = { kind: 'disabled', title: 'Shop is paused', body: 'Your account is currently restricted. Check Messages for details.' };
  else if (frames.length === 0) state = { kind: 'empty', title: 'No frames yet', body: 'New profile frames will appear here.' };

  const balance = mine.data?.balance ?? 0;
  const sel = selected;
  const selOwned = sel ? ownedRow(sel.id) : undefined;
  const short = sel ? Math.max(0, sel.coin_price - balance) : 0;

  return (
    <Screen edges={['bottom']}>
      <StateView state={state}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 140, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          {sel && profile && (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 12, borderRadius: 22, backgroundColor: c.surface }}>
              <FramedAvatar uri={profile.avatar_url} name={displayName(profile)} size={112} frame={sel} />
              <Text variant="h2">{sel.name}</Text>
              <Row gap={6}>
                <Coin size={16} />
                <Text variant="label" color={c.goldText}>{sel.coin_price.toLocaleString()}</Text>
                <Text muted>· {frameDuration(sel)}</Text>
              </Row>
              {selOwned && <Text variant="caption" color={c.success}>{selOwned.expires_at ? `Yours · ${daysLeft(selOwned.expires_at)} days left` : 'Yours forever'}</Text>}
            </View>
          )}

          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={6}><Coin size={16} /><Text variant="label">{balance.toLocaleString()} coins</Text></Row>
            <Pressable onPress={() => router.push('/wallet')} accessibilityRole="link" hitSlop={10}>
              <Text variant="label" color={c.primary}>Recharge</Text>
            </Pressable>
          </Row>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {frames.map((f) => {
              const on = sel?.id === f.id;
              const owned = ownedRow(f.id);
              return (
                <Pressable key={f.id} onPress={() => setPicked(f.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${f.name}, ${f.coin_price} coins, ${frameDuration(f)}${owned ? ', owned' : ''}${wearing === f.id ? ', wearing' : ''}`}
                  style={{ flexBasis: '47%', flexGrow: 1, alignItems: 'center', gap: 8, padding: 14, borderRadius: 18, backgroundColor: c.surface, borderWidth: 2, borderColor: on ? c.primary : 'transparent' }}>
                  <FramedAvatar uri={profile?.avatar_url} name={profile ? displayName(profile) : ''} size={64} frame={f} />
                  <Text variant="label" numberOfLines={1}>{f.name}</Text>
                  {wearing === f.id ? (
                    <Text variant="caption" color={c.primary} style={{ fontWeight: '700' }}>Wearing</Text>
                  ) : owned ? (
                    <Text variant="caption" color={c.success} style={{ fontWeight: '700' }}>Owned</Text>
                  ) : (
                    <Row gap={4}><Coin size={13} /><Text variant="caption" color={c.goldText} style={{ fontWeight: '700' }}>{f.coin_price.toLocaleString()}</Text><Text variant="caption" muted>· {frameDuration(f)}</Text></Row>
                  )}
                </Pressable>
              );
            })}
          </View>
          <Text variant="caption" muted style={{ textAlign: 'center' }}>Frames show around your photo on your profile. Coins spent on frames aren&apos;t refundable.</Text>
        </ScrollView>

        {sel && state.kind === 'success' && (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 8, backgroundColor: c.background, borderTopWidth: 1, borderTopColor: c.divider }}>
            {wearing === sel.id ? (
              <Row gap={10}>
                {sel.duration_days != null && <Button title="Renew" variant="secondary" style={{ flex: 1 }} loading={busy} disabled={offline || short > 0} onPress={() => buy(sel)} />}
                <Button title="Take off" variant="ghost" style={{ flex: 1 }} loading={busy} disabled={offline} onPress={() => void wear(null)} />
              </Row>
            ) : selOwned ? (
              <Button title={`Wear ${sel.name}`} loading={busy} disabled={offline} onPress={() => void wear(sel.id)} />
            ) : short > 0 ? (
              <Button title={`Need ${short.toLocaleString()} more coins · Recharge`} variant="gold" onPress={() => router.push('/wallet')} icon={<Ionicons name="add-circle" size={18} color={c.onGold} />} />
            ) : (
              <Button title={`Buy for ${sel.coin_price.toLocaleString()} coins`} loading={busy} disabled={offline} onPress={() => buy(sel)} />
            )}
            {offline && <Text variant="caption" muted style={{ textAlign: 'center' }}>You need a connection to buy or change frames.</Text>}
          </View>
        )}
      </StateView>
    </Screen>
  );
}
