import { useAuth } from '@clerk/clerk-expo';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useAnalytics } from '@/lib/analytics';
import { idempotencyKey, rpc } from '@/lib/api';
import { errorCode, friendlyError } from '@/lib/errors';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { GiftItem } from '@/lib/types';

import { Button, Chip, Coin, Row, Sheet, Text } from './ui';

const QUANTITIES = [1, 10, 99];

export function GiftSheet({ roomId, visible, onClose }: { roomId: string; visible: boolean; onClose: () => void }) {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c, radius } = useTheme();
  const track = useAnalytics();
  const [selected, setSelected] = useState<GiftItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per send intent: a retry after a network error reuses it, so the
  // server charges at most once. A new key is minted after success.
  const [key, setKey] = useState(idempotencyKey);

  const catalog = useAsync(async () => {
    const { data, error } = await supabase.from('gift_catalog').select('id,name,icon,coin_price').eq('active', true).order('sort');
    if (error) throw error;
    return data as GiftItem[];
  }, []);
  const wallet = useAsync(async () => {
    const { data } = await supabase.from('wallets').select('coin_balance,frozen').eq('user_id', userId!).maybeSingle();
    return data ?? { coin_balance: 0, frozen: false };
  }, [userId, visible]);
  useRealtime('wallets', `user_id=eq.${userId}`, () => wallet.reload(), visible);

  const total = (selected?.coin_price ?? 0) * quantity;
  const balance = wallet.data?.coin_balance ?? 0;
  const insufficient = !!selected && total > balance;

  const send = async () => {
    if (!selected) return;
    setSending(true);
    setError(null);
    try {
      await rpc(supabase, 'send_gift', { p_room_id: roomId, p_gift_id: selected.id, p_quantity: quantity, p_idempotency_key: key });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track('gift_sent', { room_id: roomId, gift_id: selected.id, coins: total });
      setKey(idempotencyKey());
      wallet.reload();
      onClose();
    } catch (e) {
      // Business errors are final: mint a new key so the next attempt is a new request.
      if (errorCode(e) !== 'unknown') setKey(idempotencyKey());
      setError(friendlyError(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="h2">Gifts</Text>
        <Row gap={6}>
          <Coin />
          <Text variant="label" accessibilityLabel={`Balance ${balance} coins`}>{balance.toLocaleString()}</Text>
          <Pressable onPress={() => { onClose(); router.push('/wallet'); }} accessibilityRole="link" hitSlop={10} style={{ marginLeft: 8 }}>
            <Text variant="bodySmall" color={c.gold} style={{ fontWeight: '700' }}>Recharge</Text>
          </Pressable>
        </Row>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(catalog.data ?? []).map((g) => {
          const on = selected?.id === g.id;
          return (
            <Pressable
              key={g.id}
              onPress={() => setSelected(g)}
              accessibilityRole="button"
              accessibilityLabel={`${g.name}, ${g.coin_price} coins`}
              accessibilityState={{ selected: on }}
              style={{
                width: '23%', height: 96, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius[12] + 2,
                backgroundColor: c.surfaceRaised, borderWidth: 2, borderColor: on ? c.primary : 'transparent',
              }}
            >
              <Text style={{ fontSize: 28, lineHeight: 34 }}>{g.icon}</Text>
              <Text variant="caption">{g.name}</Text>
              <Text variant="caption" color={c.gold} style={{ fontSize: 11 }}>{g.coin_price.toLocaleString()}</Text>
            </Pressable>
          );
        })}
      </View>
      <Row gap={8}>
        {QUANTITIES.map((q) => (
          <Chip key={q} label={`×${q}`} selected={quantity === q} onPress={() => setQuantity(q)} />
        ))}
      </Row>
      {error && <Text color={c.danger}>{error}</Text>}
      {wallet.data?.frozen ? (
        <Text color={c.warning}>Your wallet is on hold while a payment is reviewed.</Text>
      ) : insufficient ? (
        <Button title={`Need ${(total - balance).toLocaleString()} more coins — Recharge`} variant="gold" onPress={() => { onClose(); router.push('/wallet'); }} />
      ) : (
        <Row>
          <Text variant="bodySmall" muted style={{ flex: 1 }}>
            {selected ? `${selected.name} ×${quantity} · ${total.toLocaleString()} coins. The host gets 90%.` : 'Pick a gift to send.'}
          </Text>
          <Button title="Send" disabled={!selected} loading={sending} onPress={send} style={{ minHeight: 44, paddingHorizontal: 26 }} />
        </Row>
      )}
    </Sheet>
  );
}

/** Floating toasts for gifts arriving in a room (realtime). */
export function GiftToasts({ roomId }: { roomId: string }) {
  const supabase = useSupabase();
  const [toasts, setToasts] = useState<{ id: string; sender: string; gift: string; count: number }[]>([]);
  useRealtime('gifts', `room_id=eq.${roomId}`, async (payload) => {
    if (payload.eventType !== 'INSERT') return;
    const g = payload.new as { id: string; sender_id: string; gift_id: number; quantity: number };
    const [{ data: sender }, { data: gift }] = await Promise.all([
      supabase.from('profiles').select('display_name,username').eq('id', g.sender_id).maybeSingle(),
      supabase.from('gift_catalog').select('icon,name').eq('id', g.gift_id).maybeSingle(),
    ]);
    const toast = { id: g.id, sender: sender?.display_name ?? sender?.username ?? 'Someone', gift: `${gift?.icon ?? '🎁'} ${gift?.name ?? 'a gift'}`, count: g.quantity };
    setToasts((t) => [...t.slice(-2), toast]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== g.id)), 4000);
  });
  return (
    <View pointerEvents="none" style={{ gap: 8 }}>
      {toasts.map((t) => (
        <View key={t.id} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingLeft: 14, paddingRight: 14, borderRadius: 23, backgroundColor: 'rgba(20,16,28,0.85)', borderWidth: 1, borderColor: '#FFC24B' }}>
          <View>
            <Text variant="label" color="#fff" style={{ fontSize: 13 }}>{t.sender}</Text>
            <Text variant="caption" color="#E4DFEC">sent {t.gift}</Text>
          </View>
          {t.count > 1 && <Text variant="display" color="#FFC24B" style={{ fontSize: 24, lineHeight: 28, fontStyle: 'italic' }}>×{t.count}</Text>}
        </View>
      ))}
    </View>
  );
}
