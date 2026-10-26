import { useAuth } from '@clerk/clerk-expo';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';

import { U, units } from '@/lib/brand';
import { Pop, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Button, Coin, glassShadow, Row, Screen, Segmented, Sheet, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { reconcilePayments, startCoinCheckout } from '@/lib/api';
import { errorDetail, friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { formatMoney, type CoinPackage } from '@/lib/types';

type Tx = { id: number; delta: number; kind: string; created_at: string };

const HISTORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'gifts', label: 'Gifts sent' },
] as const;

const KIND_LABEL: Record<string, string> = {
  purchase: `${U.Spend} purchased`, gift_sent: 'Gift sent', refund: 'Refund reversal', chargeback: 'Chargeback reversal', adjustment: 'Adjustment',
};

export default function WalletScreen() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c, radius } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const [buying, setBuying] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // After checkout the coins arrive from the payment webhook; show that we're waiting rather than an unchanged balance.
  const [awaiting, setAwaiting] = useState<number | null>(null);
  // Set when Stripe sends the web app back here (?status=success|cancelled).
  const { status: returnStatus } = useLocalSearchParams<{ status?: string }>();
  const [tab, setTab] = useState<(typeof HISTORY_TABS)[number]['id']>('all');

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const [wallet, packages, txs, region] = await Promise.all([
      supabase.from('wallets').select('coin_balance,frozen').eq('user_id', userId!).maybeSingle(),
      supabase.from('coin_packages').select('id,name,coins,price_minor,currency,region').eq('active', true).order('sort'),
      supabase.from('coin_transactions').select('id,delta,kind,created_at').eq('user_id', userId!).order('created_at', { ascending: false }).limit(50),
      // Prices follow the country the account was created in (locked); never show other countries'.
      supabase.rpc('my_region'),
    ]);
    if (packages.error) throw packages.error;
    // A failed balance load must show an error, not a 0 balance.
    if (wallet.error) throw wallet.error;
    if (txs.error) throw txs.error;
    // Never guess a region when it can't be read: other countries' prices fail at checkout. The
    // balance and history still show; the prices say they couldn't load.
    const pricesFailed = !!region.error;
    const myRegion = (region.data as { code?: string } | null)?.code ?? 'GLOBAL';
    const mine = pricesFailed ? [] : (packages.data as (CoinPackage & { region: string })[]).filter((p) => p.region === myRegion);
    return { wallet: wallet.data ?? { coin_balance: 0, frozen: false }, packages: mine as CoinPackage[], pricesFailed, txs: (txs.data ?? []) as Tx[] };
  }, [userId], 'wallet');
  // Coins are credited by the Stripe webhook; the balance updates live.
  useRealtime('wallets', `user_id=eq.${userId}`, () => reload());
  // If the webhook is late or missed, the server checks this buyer's open payments with Stripe
  // directly (on open and after returning from checkout), so a paid purchase is never left uncredited.
  /** Asks the server to check this buyer's open payments with Stripe; true once nothing is pending. */
  const checkPayments = useCallback(async () => {
    try {
      const r = await reconcilePayments(supabase);
      if (r.credited || r.failed) reload();
      return r.pending === 0;
    } catch {
      return false; // best effort: the webhook remains the main path
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);
  useFocusEffect(
    useCallback(() => {
      void checkPayments();
      // returnStatus: check again when Stripe sends the web app back here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checkPayments, returnStatus]),
  );

  const buy = async (pkg: CoinPackage) => {
    setBuying(pkg.id);
    track('coin_checkout_started', { package_id: pkg.id });
    try {
      const returnTo = Linking.createURL('/checkout-return');
      const { url } = await startCoinCheckout(supabase, pkg.id, returnTo);
      if (Platform.OS === 'web') window.location.assign(url);
      else {
        const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
        const paid = result.type === 'success' && result.url.includes('status=success');
        if (paid) setAwaiting(data?.wallet.coin_balance ?? 0);
        // The phone returns to this same (still focused) screen, so check with Stripe now, and a few
        // more times after a payment, instead of waiting for the next visit. Closing the checkout
        // page early can still mean it was paid, so that is checked once too.
        void (async () => {
          for (const wait of paid ? [0, 3000, 7000, 15000, 30000] : [0]) {
            if (wait) await new Promise((r) => setTimeout(r, wait));
            if (await checkPayments()) return;
          }
        })();
      }
      reload();
    } catch (e) {
      const detail = errorDetail(e);
      Alert.alert('Checkout unavailable', detail ? `${friendlyError(e)}\n\n${detail}` : friendlyError(e));
    } finally {
      setBuying(null);
    }
  };

  return (
    <Screen edges={[]}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data && (() => {
          // Tags (Redesign v2): the middle pack is "Popular" (and selected first), the biggest is "Best value".
          const popularId = data.packages.length >= 3 ? data.packages[2].id : null;
          const bestId = data.packages.length >= 4 ? data.packages[data.packages.length - 1].id : null;
          const pick = data.packages.find((p) => p.id === selected) ?? data.packages.find((p) => p.id === popularId) ?? data.packages[1] ?? data.packages[0];
          return (
            <>
            {/* History lives behind the clock button at the top right, not at the bottom of the page. */}
            <Stack.Screen options={{ headerRight: () => (
              <Pressable onPress={() => setHistoryOpen(true)} accessibilityRole="button" accessibilityLabel="History" hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="time-outline" size={21} color={c.text} />
                <Text variant="label">History</Text>
              </Pressable>
            ) }} />
            <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
              <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ padding: 22, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ gap: 4 }}>
                  <Text variant="bodySmall" color={c.primaryText} style={{ opacity: 0.9 }}>Your {U.spend}</Text>
                  <Row gap={8}><Coin size={28} /><Text variant="display" color={c.primaryText} accessibilityLiveRegion="polite">{data.wallet.coin_balance.toLocaleString()}</Text></Row>
                </View>
                <Text variant="caption" color={c.primaryText} style={{ maxWidth: 130, textAlign: 'right', opacity: 0.9 }}>
                  {data.wallet.frozen ? 'On hold while a payment dispute is reviewed' : 'Used to send gifts in live rooms'}
                </Text>
              </LinearGradient>

              <View style={{ gap: 10 }}>
                <Text variant="h3">Buy {U.spend}</Text>
                {data.pricesFailed ? (
                  <Row gap={10} style={{ padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
                    <Text variant="bodySmall" muted style={{ flex: 1 }}>Couldn&apos;t load prices for your country.</Text>
                    <Button title="Try again" variant="secondary" onPress={reload} style={{ minHeight: 40, paddingHorizontal: 16 }} />
                  </Row>
                ) : data.packages.length === 0 ? (
                  <Text variant="bodySmall" muted style={{ padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
                    {U.Spend} aren&apos;t on sale in your country yet. We&apos;ll add your country soon.
                  </Text>
                ) : null}
                <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {data.packages.map((p, i) => {
                    const on = pick?.id === p.id;
                    return (
                      <Pop key={p.id} delay={stagger(i, 50)} from={0.85} style={{ width: '48.5%' }}>
                      <PressScale
                        scaleTo={0.96}
                        disabled={buying !== null}
                        onPress={() => setSelected(p.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        // The web needs aria-checked on a radio. No custom label: screen readers read the card's
                        // own text ("140", "$1.99 · Starter"), which is what the audit requires.
                        aria-checked={on}
                        style={{ width: '100%', minHeight: 76, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius[16], backgroundColor: on ? c.violetSurface : c.surface, borderWidth: 2, borderColor: on ? c.primary : c.divider, gap: 4 }}
                      >
                        {(p.id === popularId || p.id === bestId) && (
                          <View style={{ position: 'absolute', top: -9, right: 10, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: c.live }}>
                            <Text variant="caption" color="#fff" style={{ fontSize: 10, fontWeight: '700' }}>{p.id === popularId ? 'Popular' : 'Best value'}</Text>
                          </View>
                        )}
                        <Row gap={6}><Coin size={14} /><Text variant="h3" style={{ fontSize: 18 }}>{p.coins.toLocaleString()}</Text></Row>
                        <Text variant="bodySmall" muted>{formatMoney(p.price_minor, p.currency)} · {p.name}</Text>
                      </PressScale>
                      </Pop>
                    );
                  })}
                </View>
              </View>

              {awaiting !== null && data.wallet.coin_balance === awaiting && (
                <Row gap={10} style={{ padding: 14, borderRadius: 16, backgroundColor: c.violetSurface, borderWidth: 1, borderColor: c.violetBorder }}>
                  <ActivityIndicator color={c.violetText} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label">Waiting for payment confirmation</Text>
                    <Text variant="caption" muted>{U.Spend} are added as soon as the payment provider confirms. Don&apos;t pay again.</Text>
                  </View>
                </Row>
              )}
              {awaiting === null && returnStatus === 'success' && (
                <Text variant="label" accessibilityRole="alert">Payment received — your {U.spend} appear here as soon as it&apos;s confirmed. Don&apos;t pay again.</Text>
              )}
              {returnStatus === 'cancelled' && <Text variant="caption" muted accessibilityRole="alert">Checkout cancelled — you weren&apos;t charged.</Text>}
              {awaiting !== null && data.wallet.coin_balance > awaiting && (
                <Text variant="label" color={c.success} accessibilityRole="alert">Payment confirmed — {U.spend} added.</Text>
              )}
              {pick && (
                <Button
                  title={buying ? 'Opening checkout…' : `Buy ${units(pick.coins)} · ${formatMoney(pick.price_minor, pick.currency)}`}
                  loading={buying !== null}
                  disabled={offline}
                  onPress={() => buy(pick)}
                />
              )}
              <Row gap={8} style={{ padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
                <Text style={{ flex: 1, fontSize: 15 }}>Pay with card</Text>
                <Text variant="caption" faint>Secure checkout · Stripe</Text>
              </Row>
              <Text variant="caption" faint>{U.Spend} are added only after the payment is confirmed.</Text>

            </ScrollView>
            <Sheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="History">
              <View style={{ gap: 4, flexShrink: 1 }}>
                <View style={{ paddingVertical: 6 }}>
                  <Segmented options={HISTORY_TABS} value={tab} onChange={setTab} />
                </View>
                <ScrollView style={{ flexShrink: 1 }}>
                {(() => {
                  const txs = data.txs.filter((t) => tab === 'all' || (tab === 'purchases' ? t.kind === 'purchase' : t.kind === 'gift_sent'));
                  return txs.length === 0 ? <Text muted style={{ paddingVertical: 12 }}>{tab === 'gifts' ? 'No gifts sent yet.' : tab === 'purchases' ? 'No purchases yet.' : 'No transactions yet.'}</Text> : txs.map((t) => {
                  const credit = t.delta > 0;
                  return (
                    <Row key={t.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider }}>
                      <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: credit ? c.goldSurface : c.surfaceRaised }}>
                        <Text variant="label" color={credit ? c.gold : c.textMuted} style={{ fontSize: 15 }}>{credit ? '+' : '−'}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontWeight: '500', fontSize: 14 }}>{KIND_LABEL[t.kind] ?? t.kind}</Text>
                        <Text variant="caption" faint>{new Date(t.created_at).toLocaleString()}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 3 }}>
                        <Text variant="label" color={credit ? c.success : c.text}>{credit ? '+' : ''}{t.delta.toLocaleString()}</Text>
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: t.kind === 'refund' || t.kind === 'chargeback' ? c.violetSurface : c.surface }}>
                          <Text variant="caption" style={{ fontSize: 11, fontWeight: '700' }} color={t.kind === 'refund' || t.kind === 'chargeback' ? c.violetText : c.success}>
                            {t.kind === 'refund' || t.kind === 'chargeback' ? 'Refunded' : 'Completed'}
                          </Text>
                        </View>
                      </View>
                    </Row>
                  );
                });
                })()}
                </ScrollView>
              </View>
            </Sheet>
            </>
          );
        })()}
      </StateView>
    </Screen>
  );
}
