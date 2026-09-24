import { useAuth } from '@clerk/clerk-expo';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Card, Row, Screen, Text } from '@/components/ui';
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
        {data && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            <Card style={{ alignItems: 'center', backgroundColor: c.primary, borderColor: c.primary }}>
              <Text variant="label" color={c.primaryText}>Balance</Text>
              <Text variant="display" color={c.primaryText}>🪙 {data.wallet.coin_balance.toLocaleString()}</Text>
              {data.wallet.frozen && <Text color={c.primaryText}>On hold while a payment dispute is reviewed</Text>}
            </Card>

            <Text variant="h3">Buy coins</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {data.packages.map((p) => (
                <Pressable
                  key={p.id}
                  disabled={buying !== null || offline}
                  onPress={() => buy(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.coins} coins for ${formatMoney(p.price_minor, p.currency)}`}
                  style={{ width: '47%', padding: 16, borderRadius: radius[16], backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: 4, opacity: buying && buying !== p.id ? 0.5 : 1 }}
                >
                  <Text variant="caption" muted>{p.name}</Text>
                  <Text variant="h2">🪙 {p.coins.toLocaleString()}</Text>
                  <Text variant="label" color={c.primary}>{buying === p.id ? 'Opening checkout…' : formatMoney(p.price_minor, p.currency)}</Text>
                </Pressable>
              ))}
            </View>
            <Text variant="caption" muted>Payments are processed by Stripe. Coins are added automatically once payment is confirmed.</Text>

            <Text variant="h3">History</Text>
            {data.txs.length === 0 ? <Text muted>No transactions yet.</Text> : data.txs.map((t) => (
              <Row key={t.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <View>
                  <Text>{KIND_LABEL[t.kind] ?? t.kind}</Text>
                  <Text variant="caption" muted>{new Date(t.created_at).toLocaleString()}</Text>
                </View>
                <Text variant="label" color={t.delta > 0 ? c.success : c.text}>{t.delta > 0 ? '+' : ''}{t.delta.toLocaleString()}</Text>
              </Row>
            ))}
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}
