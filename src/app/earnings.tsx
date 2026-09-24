import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Chip, Input, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { formatMoney } from '@/lib/types';

const METHODS = [
  { id: 'easypaisa', label: 'Easypaisa' },
  { id: 'jazzcash', label: 'JazzCash' },
  { id: 'bank', label: 'Bank (IBAN)' },
] as const;

type Withdrawal = { id: string; coins: number; amount_minor: number; currency: string; status: string; review_note: string | null; created_at: string };

export default function EarningsScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const [coins, setCoins] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('easypaisa');
  const [account, setAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { host } = useProfile();
  const verified = host?.verification_status === 'approved';

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const [earnings, withdrawals, settings] = await Promise.all([
      supabase.from('creator_earnings').select('balance,held,lifetime').eq('host_id', userId!).maybeSingle(),
      supabase.from('withdrawals').select('*').eq('host_id', userId!).order('created_at', { ascending: false }).limit(30),
      supabase.from('platform_settings').select('value').eq('key', 'withdrawal').single(),
    ]);
    const cfg = settings.data?.value as { pkr_per_coin: number | null; min_coins: number } | undefined;
    return {
      earnings: earnings.data ?? { balance: 0, held: 0, lifetime: 0 },
      withdrawals: (withdrawals.data ?? []) as Withdrawal[],
      rate: cfg?.pkr_per_coin ?? null,
      minCoins: cfg?.min_coins ?? 0,
    };
  }, [userId]);

  const amount = Number.parseInt(coins, 10);
  const valid = Number.isFinite(amount) && amount > 0 && account.trim().length >= 6;

  const withdraw = async () => {
    setSubmitting(true);
    try {
      await rpc(supabase, 'request_withdrawal', { p_coins: amount, p_payout_method: { type: method, account: account.trim() } });
      track('withdrawal_requested', { coins: amount });
      setCoins('');
      Alert.alert('Requested', "We'll review your withdrawal and notify you.");
      reload();
    } catch (e) {
      Alert.alert('Withdrawal failed', friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={[]}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Card style={{ flex: 1, alignItems: 'center' }}><Text variant="caption" muted>Available</Text><Text variant="h2">💎 {data.earnings.balance.toLocaleString()}</Text></Card>
              <Card style={{ flex: 1, alignItems: 'center' }}><Text variant="caption" muted>In review</Text><Text variant="h2">{data.earnings.held.toLocaleString()}</Text></Card>
              <Card style={{ flex: 1, alignItems: 'center' }}><Text variant="caption" muted>Lifetime</Text><Text variant="h2">{data.earnings.lifetime.toLocaleString()}</Text></Card>
            </Row>

            <Card>
              <Text variant="h3">Withdraw</Text>
              {!verified ? (
                <>
                  <Text muted>Verify your identity before withdrawing — it takes about 2 minutes.</Text>
                  <Button title="Verify identity" variant="secondary" onPress={() => router.push('/create')} />
                </>
              ) : data.rate === null ? (
                <Text muted>Withdrawals open soon — the coin payout rate is being finalised.</Text>
              ) : (
                <>
                  <Text muted>1 coin = Rs {data.rate} · minimum {data.minCoins.toLocaleString()} coins</Text>
                  <Input label="Coins" value={coins} onChangeText={(t) => setCoins(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder={String(data.minCoins)} />
                  {Number.isFinite(amount) && amount > 0 && <Text variant="label">≈ Rs {(amount * data.rate).toLocaleString()}</Text>}
                  <Row gap={8} style={{ flexWrap: 'wrap' }}>
                    {METHODS.map((m) => <Chip key={m.id} label={m.label} selected={method === m.id} onPress={() => setMethod(m.id)} />)}
                  </Row>
                  <Input label={method === 'bank' ? 'IBAN' : 'Mobile account number'} value={account} onChangeText={setAccount} autoCapitalize="characters" />
                  <Button title="Request withdrawal" onPress={withdraw} loading={submitting} disabled={!valid || offline} />
                </>
              )}
            </Card>

            <Text variant="h3">Withdrawals</Text>
            {data.withdrawals.length === 0 ? <Text muted>None yet.</Text> : data.withdrawals.map((w) => (
              <Row key={w.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <View>
                  <Text>{w.coins.toLocaleString()} coins · {formatMoney(w.amount_minor, w.currency)}</Text>
                  <Text variant="caption" muted>{new Date(w.created_at).toLocaleDateString()}{w.review_note ? ` · ${w.review_note}` : ''}</Text>
                </View>
                <Text variant="label" color={w.status === 'rejected' ? c.danger : w.status === 'paid' ? c.success : c.warning}>{w.status}</Text>
              </Row>
            ))}
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}
