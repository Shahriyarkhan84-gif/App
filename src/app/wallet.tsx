import { useAuth } from '@clerk/clerk-expo';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';

import { Pop, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Button, Coin, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { startCoinCheckout } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { formatMoney, type CoinPackage } from '@/lib/types';

type Tx = { id: number; delta: number; kind: string; created_at: string };

const KIND_LABEL: Record<string, string> = {
  purchase: 'Coins purchased', gift_sent: 'Gift sent', refund: 'Refund reversal', chargeback: 'Chargeback reversal', adjustment: 'Adjustment',
};

export default function WalletScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c, radius } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const [buying, setBuying] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const [wallet, packages, txs] = await Promise.all([
      supabase.from('wallets').select('coin_balance,frozen').eq('user_id', userId!).maybeSingle(),
      supabase.from('coin_packages').select('id,name,coins,price_minor,currency').eq('active', true).order('sort'),
      supabase.from('coin_transactions').select('id,delta,kind,created_at').eq('user_id', userId!).order('created_at', { ascending: false }).limit(50),
    ]);
    if (packages.error) throw packages.error;
    return { wallet: wallet.data ?? { coin_balance: 0, frozen: false }, packages: packages.data as CoinPackage[], txs: (txs.data ?? []) as Tx[] };
  }, [userId]);
  // Coins are credited by the Stripe webhook; the balance updates live.
  useRealtime('wallets', `user_id=eq.${userId}`, () => reload());

  const buy = async (pkg: CoinPackage) => {
    setBuying(pkg.id);
    track('coin_checkout_started', { package_id: pkg.id });
    try {
      const returnTo = Linking.createURL('/checkout-return');
      const { url } = await startCoinCheckout(supabase, pkg.id, returnTo);
      if (Platform.OS === 'web') window.location.assign(url);
      else await WebBrowser.openAuthSessionAsync(url, returnTo);
      reload();
    } catch (e) {
      Alert.alert('Checkout unavailable', friendlyError(e));
    } finally {
      setBuying(null);
    }
  };

  return (
    <Screen edges={[]}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data && (() => {
          const pick = data.packages.find((p) => p.id === selected) ?? data.packages[1] ?? data.packages[0];
          return (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
              <Row style={{ padding: 20, borderRadius: 22, backgroundColor: c.goldSurface, borderWidth: 1, borderColor: c.goldBorder, justifyContent: 'space-between', experimental_backgroundImage: 'linear-gradient(135deg, #7A5A12, #2A2110)' }}>
                <View style={{ gap: 4 }}>
                  <Row gap={6}><Coin /><Text variant="bodySmall" color={c.goldText}>Coin balance</Text></Row>
                  <Text variant="display" accessibilityLiveRegion="polite">{data.wallet.coin_balance.toLocaleString()}</Text>
                </View>
                <Text variant="caption" color={c.goldText} style={{ maxWidth: 130, textAlign: 'right' }}>
                  {data.wallet.frozen ? 'On hold while a payment dispute is reviewed' : 'Used to send gifts in live rooms'}
                </Text>
              </Row>

              <View style={{ gap: 10 }}>
                <Text variant="h3">Buy coins</Text>
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
                        accessibilityLabel={`${p.coins} coins for ${formatMoney(p.price_minor, p.currency)}`}
                        style={{ width: '100%', minHeight: 76, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius[16], backgroundColor: c.surface, borderWidth: 2, borderColor: on ? c.primary : c.divider, gap: 4 }}
                      >
                        <Row gap={6}><Coin size={14} /><Text variant="h3" style={{ fontSize: 18 }}>{p.coins.toLocaleString()}</Text></Row>
                        <Text variant="bodySmall" muted>{formatMoney(p.price_minor, p.currency)} · {p.name}</Text>
                      </PressScale>
                      </Pop>
                    );
                  })}
                </View>
              </View>

              {pick && (
                <Button
                  title={buying ? 'Opening checkout…' : `Buy ${pick.coins.toLocaleString()} coins · ${formatMoney(pick.price_minor, pick.currency)}`}
                  loading={buying !== null}
                  disabled={offline}
                  onPress={() => buy(pick)}
                />
              )}
              <Text variant="caption" faint>Payments are processed by Stripe. Coins are added only after the payment is confirmed.</Text>

              <View style={{ gap: 4 }}>
                <Text variant="h3">History</Text>
                {data.txs.length === 0 ? <Text muted>No transactions yet.</Text> : data.txs.map((t) => {
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
                      <Text variant="label" color={credit ? c.success : c.text}>{credit ? '+' : ''}{t.delta.toLocaleString()}</Text>
                    </Row>
                  );
                })}
              </View>
            </ScrollView>
          );
        })()}
      </StateView>
    </Screen>
  );
}
