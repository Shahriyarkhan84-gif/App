import { useAuth } from '@clerk/clerk-expo';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { U, units } from '@/lib/brand';
import { useAnalytics } from '@/lib/analytics';
import { idempotencyKey, rpc } from '@/lib/api';
import { errorCode, friendlyError } from '@/lib/errors';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors, useTheme } from '@/lib/theme';
import type { GiftItem } from '@/lib/types';

import { FadeIn, Pop, PressScale, SlideIn, stagger } from './Motion';
import { Button, Chip, Coin, Row, Sheet, Text } from './ui';

const QUANTITIES = [1, 10, 99];

export function GiftSheet({ roomId, visible, onClose }: { roomId: string; visible: boolean; onClose: () => void }) {
  const supabase = useSupabase();
  const { userId } = useAuth();
  // Gifts are sent from live video, so the sheet is the dark navy live look.
  const { radius } = useTheme();
  const c = liveColors;
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
  }, [], 'gift-catalog');
  const wallet = useAsync(async () => {
    const [{ data, error }, split] = await Promise.all([
      supabase.from('wallets').select('coin_balance,frozen').eq('user_id', userId!).maybeSingle(),
      supabase.from('platform_settings').select('value').eq('key', 'gift_split').maybeSingle(),
    ]);
    // A failed load must not look like an empty wallet.
    if (error) throw error;
    const hostPct = (split.data?.value as { host_pct?: number } | undefined)?.host_pct ?? null;
    return { ...(data ?? { coin_balance: 0, frozen: false }), hostPct };
  }, [userId, visible]);

  // A different gift or quantity is a different send: never reuse the old idempotency key for it.
  // Re-tapping the same choice keeps the key, so a retry after a network error can't charge twice.
  const pick = (g: GiftItem) => {
    if (g.id === selected?.id) return;
    setSelected(g);
    setKey(idempotencyKey());
  };
  const pickQuantity = (q: number) => {
    if (q === quantity) return;
    setQuantity(q);
    setKey(idempotencyKey());
  };
  useRealtime('wallets', `user_id=eq.${userId}`, () => wallet.reload(), visible);
  // An old error (e.g. not enough coins) shouldn't greet the user next time the sheet opens.
  const close = () => {
    setError(null);
    onClose();
  };

  const total = (selected?.coin_price ?? 0) * quantity;
  const balance = wallet.data?.coin_balance ?? 0;
  // Until the wallet loads, the balance is unknown: don't claim the user needs more coins.
  const balanceKnown = !!wallet.data;
  const insufficient = balanceKnown && !!selected && total > balance;

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
    <Sheet visible={visible} onClose={close} tone="live">
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="h2" color={c.text}>Gifts</Text>
        <Row gap={6}>
          <Coin />
          <Text variant="label" color={c.primary} accessibilityLabel={`Balance ${units(balance)}`}>{balanceKnown ? balance.toLocaleString() : "…"}</Text>
          <Pressable onPress={() => { close(); router.push('/wallet'); }} accessibilityRole="link" hitSlop={10} style={{ marginLeft: 8 }}>
            <Text variant="bodySmall" color={c.gold} style={{ fontWeight: '700' }}>Recharge</Text>
          </Pressable>
        </Row>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(catalog.data ?? []).map((g, i) => {
          const on = selected?.id === g.id;
          return (
            <Pop key={g.id} delay={stagger(i, 40)} from={0.6} style={{ width: '23%' }}>
            <PressScale
              onPress={() => pick(g)}
              accessibilityRole="button"
              accessibilityLabel={`${g.name}, ${units(g.coin_price)}`}
              accessibilityState={{ selected: on }}
              style={{
                width: '100%', height: 96, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius[12] + 2,
                backgroundColor: on ? 'rgba(125,211,252,0.12)' : c.surfaceRaised, borderWidth: on ? 1.5 : 1, borderColor: on ? c.primary : c.border,
              }}
            >
              <Text style={{ fontSize: 28, lineHeight: 34 }}>{g.icon}</Text>
              <Text variant="caption" color={c.text}>{g.name}</Text>
              <Text variant="caption" color={c.primary} style={{ fontSize: 12, fontWeight: '700' }}>{g.coin_price.toLocaleString()}</Text>
            </PressScale>
            </Pop>
          );
        })}
      </View>
      <Row gap={8}>
        {QUANTITIES.map((q) => (
          <Chip key={q} label={`×${q}`} selected={quantity === q} onPress={() => pickQuantity(q)} />
        ))}
      </Row>
      {error && <Text color={c.danger}>{error}</Text>}
      {wallet.error && <Text color={c.danger}>Couldn&apos;t load your balance. Close and try again.</Text>}
      {wallet.data?.frozen ? (
        <Text color={c.warning}>Your {U.spend} are on hold while a payment is reviewed.</Text>
      ) : insufficient ? (
        <Button title={`Need ${(total - balance).toLocaleString()} more ${U.spend} — Recharge`} variant="gold" onPress={() => { close(); router.push('/wallet'); }} />
      ) : (
        <Row>
          <Text variant="bodySmall" color={c.textMuted} style={{ flex: 1 }}>
            {selected ? `${selected.name} ×${quantity} · ${units(total)}.${wallet.data?.hostPct != null ? ` The host gets ${wallet.data.hostPct}%.` : ''}` : 'Pick a gift to send.'}
          </Text>
          <Button title="Send" disabled={!selected || !balanceKnown} loading={sending} onPress={send} style={{ minHeight: 44, paddingHorizontal: 26 }} />
        </Row>
      )}
    </Sheet>
  );
}

// Toast lookups shared by every viewer screen: the gift catalogue is loaded once (refreshed after
// 10 minutes) and each sender's name once, so a busy live doesn't cost every viewer two database
// requests per gift.
const TOAST_CATALOG_MS = 10 * 60_000;
let toastCatalog: { at: number; byId: Map<number, { icon: string; name: string; coin_price: number }> } | null = null;
let toastCatalogLoad: Promise<void> | null = null;
const senderNames = new Map<string, string>();
const MAX_SENDER_NAMES = 500;

// Gifts worth this many diamonds or more (price × quantity) also play the full-screen effect.
export const BIG_GIFT_COINS = 999;
type BigGift = { id: string; sender: string; icon: string; name: string; count: number };
const bigGiftListeners = new Set<(g: BigGift) => void>();

/** Floating toasts for gifts arriving in a room (realtime). The same gift from the same sender
 * within a few seconds adds up into one combo toast instead of a new one. */
export function GiftToasts({ roomId }: { roomId: string }) {
  const supabase = useSupabase();
  const [toasts, setToasts] = useState<{ id: string; key: string; sender: string; gift: string; count: number }[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);
  const giftFor = async (giftId: number) => {
    if (!toastCatalog?.byId.has(giftId) || Date.now() - toastCatalog.at > TOAST_CATALOG_MS) {
      toastCatalogLoad ??= Promise.resolve(supabase.from('gift_catalog').select('id,icon,name,coin_price'))
        .then(({ data }) => {
          if (data) toastCatalog = { at: Date.now(), byId: new Map(data.map((g) => [g.id as number, g as { icon: string; name: string; coin_price: number }])) };
        })
        .catch(() => {})
        .finally(() => {
          toastCatalogLoad = null;
        });
      await toastCatalogLoad;
    }
    return toastCatalog?.byId.get(giftId);
  };
  const senderFor = async (senderId: string) => {
    const known = senderNames.get(senderId);
    if (known) return known;
    const { data } = await supabase.from('profiles').select('display_name,username').eq('id', senderId).maybeSingle();
    const name = data?.display_name ?? data?.username ?? 'Someone';
    if (senderNames.size >= MAX_SENDER_NAMES) senderNames.clear();
    if (data) senderNames.set(senderId, name);
    return name;
  };
  useRealtime('gifts', `room_id=eq.${roomId}`, async (payload) => {
    if (payload.eventType !== 'INSERT') return;
    const g = payload.new as { id: string; sender_id: string; gift_id: number; quantity: number; coins_total?: number };
    const [sender, gift] = await Promise.all([senderFor(g.sender_id), giftFor(g.gift_id)]);
    const key = `${g.sender_id}:${g.gift_id}`;
    const label = `${gift?.icon ?? '🎁'} ${gift?.name ?? 'a gift'}`;
    setToasts((all) => {
      const combo = all.find((x) => x.key === key);
      if (combo) return all.map((x) => (x.key === key ? { ...x, id: g.id, count: x.count + g.quantity } : x));
      return [...all.slice(-2), { id: g.id, key, sender, gift: label, count: g.quantity }];
    });
    const old = timers.current.get(key);
    if (old) clearTimeout(old);
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      setToasts((t) => t.filter((x) => x.key !== key));
    }, 4000));
    const coins = g.coins_total ?? (gift?.coin_price ?? 0) * g.quantity;
    if (coins >= BIG_GIFT_COINS) bigGiftListeners.forEach((l) => l({ id: g.id, sender, icon: gift?.icon ?? '🎁', name: gift?.name ?? 'a gift', count: g.quantity }));
  });
  return (
    <View pointerEvents="none" style={{ gap: 8 }}>
      {toasts.map((t) => (
        <FadeIn key={t.key} from={0} style={{ alignSelf: 'flex-start' }}>
        <SlideIn style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingLeft: 14, paddingRight: 14, borderRadius: 23, backgroundColor: 'rgba(6,24,38,0.85)', borderWidth: 1, borderColor: '#FFC24B' }}>
          <View>
            <Text variant="label" color="#fff" style={{ fontSize: 13 }}>{t.sender}</Text>
            <Text variant="caption" color="#D6F0FF">sent {t.gift}</Text>
          </View>
          {t.count > 1 && <Pop key={t.count} delay={250} from={2}><Text variant="display" color="#FFC24B" style={{ fontSize: 24, lineHeight: 28, fontStyle: 'italic' }}>×{t.count}</Text></Pop>}
        </SlideIn>
        </FadeIn>
      ))}
    </View>
  );
}

/**
 * Full-screen moment for a big gift (see BIG_GIFT_COINS), fed by the room's <GiftToasts>.
 * Put it last in the screen so it draws over the video; it never takes touches.
 */
export function BigGiftBurst() {
  const [queue, setQueue] = useState<BigGift[]>([]);
  useEffect(() => {
    const add = (g: BigGift) => setQueue((q) => (q.length >= 3 ? q : [...q, g]));
    bigGiftListeners.add(add);
    return () => {
      bigGiftListeners.delete(add);
    };
  }, []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 3200);
    return () => clearTimeout(t);
  }, [current]);
  if (!current) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,24,38,0.35)' }}
      accessibilityLiveRegion="polite" accessibilityLabel={`${current.sender} sent ${current.name}`}>
      <Pop key={current.id} from={0.2} style={{ alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 120, lineHeight: 140 }}>{current.icon}</Text>
        <View style={{ alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, backgroundColor: 'rgba(6,24,38,0.8)', borderWidth: 1, borderColor: '#FFC24B' }}>
          <Text variant="label" color="#fff">{current.sender}</Text>
          <Text variant="h3" color="#FFC24B">sent {current.name}{current.count > 1 ? ` ×${current.count}` : ''}</Text>
        </View>
      </Pop>
    </View>
  );
}
