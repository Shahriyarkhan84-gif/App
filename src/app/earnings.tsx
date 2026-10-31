import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { U, units } from '@/lib/brand';
import { resolveState, StateView } from '@/components/StateView';
import { FadeIn } from '@/components/Motion';
import { Bean, Button, Card, Chip, Input, Row, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { rpc, sendMyPayouts } from '@/lib/api';
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

type Withdrawal = { id: string; coins: number; amount_minor: number; currency: string; status: string; auto: boolean; review_note: string | null; created_at: string };

/** What the host sees for each withdrawal; automatic payouts read "Sending" until they're paid. */
function statusLabel(w: Withdrawal) {
  if (w.status === 'sending' || (w.status === 'approved' && w.auto)) return 'Sending';
  if (w.status === 'requested') return 'In review';
  return w.status === 'approved' ? 'Approved' : w.status === 'paid' ? 'Paid' : 'Rejected';
}

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
    // Gifts land as tallies first (so a busy host's gifts don't queue); fold ours in for an exact balance.
    // Best-effort: an older server without this RPC still shows the stored balance.
    await supabase.rpc('settle_my_earnings');
    const [earnings, withdrawals, settings, withdrawable] = await Promise.all([
      supabase.from('creator_earnings').select('balance,held,lifetime').eq('host_id', userId!).maybeSingle(),
      supabase.from('withdrawals').select('*').eq('host_id', userId!).order('created_at', { ascending: false }).limit(30),
      supabase.from('platform_settings').select('value').eq('key', 'withdrawal').single(),
      // Gifts still inside the hold window can't be withdrawn yet; the server enforces this too.
      supabase.rpc('my_withdrawable_coins'),
    ]);
    // A failed load must show an error, not a zero balance.
    if (earnings.error) throw earnings.error;
    if (withdrawals.error) throw withdrawals.error;
    const cfg = settings.data?.value as { pkr_per_coin: number | null; min_coins: number } | undefined;
    return {
      earnings: earnings.data ?? { balance: 0, held: 0, lifetime: 0 },
      withdrawals: (withdrawals.data ?? []) as Withdrawal[],
      rate: cfg?.pkr_per_coin ?? null,
      minCoins: cfg?.min_coins ?? 0,
      withdrawable: withdrawable.error ? null : Number(withdrawable.data ?? 0),
    };
  }, [userId], 'earnings');

  // An automatic payout still waiting to go out: wake the sender (the server only sends this host's
  // own; at most every 30 s), and check again shortly so "Sending" turns into "Paid" on screen.
  const lastWake = useRef(0);
  const waiting = !!data?.withdrawals.some((w) => w.auto && (w.status === 'approved' || w.status === 'sending'));
  useEffect(() => {
    if (!waiting) return;
    if (Date.now() - lastWake.current > 30_000) {
      lastWake.current = Date.now();
      void sendMyPayouts(supabase).then((r) => { if (r && r.sent + r.failed > 0) reload(); });
    }
    const t = setTimeout(reload, 20_000);
    return () => clearTimeout(t);
  }, [waiting, data, supabase, reload]);

  const amount = Number.parseInt(coins, 10);
  const max = data ? data.withdrawable ?? data.earnings.balance : 0;
  const amountError = !coins || !data ? null
    : amount < data.minCoins ? `Minimum ${units(data.minCoins, 'earn')}`
    : amount > max ? `You can withdraw up to ${units(max, 'earn')} right now`
    : null;
  const accountError = account && account.trim().length < 6 ? 'Enter the full account number' : null;
  const valid = Number.isFinite(amount) && amount > 0 && !amountError && account.trim().length >= 6;

  const withdraw = async () => {
    setSubmitting(true);
    try {
      const w = await rpc<Withdrawal>(supabase, 'request_withdrawal', { p_coins: amount, p_payout_method: { type: method, account: account.trim() } });
      track('withdrawal_requested', { coins: amount, auto: !!w?.auto });
      setCoins('');
      if (w?.auto) Alert.alert('On its way', "Your payout is being sent. We'll notify you when it arrives.");
      else Alert.alert('Requested', "We'll review your withdrawal and notify you. After your first payout to this account, small withdrawals are sent automatically.");
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
            <FadeIn>
              {/* Aurora dark: earnings sit on a warm amber-to-violet card, white text. */}
              <LinearGradient colors={['#B45309', '#9A3412', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 20, borderRadius: 22, gap: 10 }}>
                <Text variant="bodySmall" color="#FFFFFF">Available {U.earn}</Text>
                <Row gap={10}><Bean size={24} /><Text variant="display" color="#FFFFFF" accessibilityLiveRegion="polite">{data.earnings.balance.toLocaleString()}</Text></Row>
                <Row gap={24}>
                  <View><Text variant="label" color="#FFFFFF">{data.earnings.held.toLocaleString()}</Text><Text variant="caption" color="#FFFFFF">In review</Text></View>
                  <View><Text variant="label" color="#FFFFFF">{data.earnings.lifetime.toLocaleString()}</Text><Text variant="caption" color="#FFFFFF">Lifetime</Text></View>
                </Row>
              </LinearGradient>
            </FadeIn>

            <Card>
              <Text variant="h3">Withdraw</Text>
              {!verified ? (
                <>
                  <Text muted>Verify your identity before withdrawing — it takes about 2 minutes.</Text>
                  <Button title="Verify identity" variant="secondary" onPress={() => router.push('/hosting')} />
                </>
              ) : data.rate === null ? (
                <Text muted>Withdrawals open soon — the payout rate is being finalised.</Text>
              ) : (
                <>
                  <Text muted>1 {U.earnOne} = Rs {data.rate} · minimum {units(data.minCoins, 'earn')}</Text>
                  {data.withdrawable !== null && data.withdrawable < data.earnings.balance && (
                    <Text variant="caption" muted>{units(data.withdrawable, 'earn')} can be withdrawn now; newer gifts unlock after the hold period.</Text>
                  )}
                  <Input label={U.Earn} value={coins} onChangeText={(t) => setCoins(t.replace(/\D/g, '').slice(0, 9))} keyboardType="number-pad" placeholder={String(data.minCoins)} error={amountError ?? undefined} />
                  {Number.isFinite(amount) && amount > 0 && <Text variant="label">≈ Rs {(amount * data.rate).toLocaleString()}</Text>}
                  <Row gap={8} style={{ flexWrap: 'wrap' }}>
                    {METHODS.map((m) => <Chip key={m.id} label={m.label} selected={method === m.id} onPress={() => setMethod(m.id)} />)}
                  </Row>
                  <Input label={method === 'bank' ? 'IBAN' : 'Mobile account number'} value={account} onChangeText={setAccount} autoCapitalize="characters" error={accountError ?? undefined} />
                  <Button title="Request withdrawal" onPress={withdraw} loading={submitting} disabled={!valid || offline} />
                </>
              )}
            </Card>

            <Text variant="h3">Withdrawal history</Text>
            {data.withdrawals.length === 0 ? <Text muted>None yet.</Text> : data.withdrawals.map((w) => (
              <Row key={w.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <View>
                  <Text>{w.coins.toLocaleString()} coins · {formatMoney(w.amount_minor, w.currency)}</Text>
                  <Text variant="caption" muted>{new Date(w.created_at).toLocaleDateString()}{w.review_note ? ` · ${w.review_note}` : ''}</Text>
                </View>
                <Text variant="label" color={w.status === 'rejected' ? c.danger : w.status === 'paid' ? c.success : c.warning}>{statusLabel(w)}</Text>
              </Row>
            ))}
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}
