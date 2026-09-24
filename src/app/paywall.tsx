import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { useAnalytics } from '@/lib/analytics';
import { createCheckoutSession } from '@/lib/api';
import { useSubscription } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';

const PLANS = [
  { id: 'monthly', label: 'Monthly', price: '$7.99', period: '/month', note: 'Cancel anytime' },
  { id: 'yearly', label: 'Yearly', price: '$79.99', period: '/year', note: '2 months free' },
] as const;

const PERKS = ['Every title in the library', 'Full HD streaming', 'No ads, ever', 'Watch on phone, tablet and web'];

export default function PaywallScreen() {
  const { videoId } = useLocalSearchParams<{ videoId?: string }>();
  const supabase = useSupabase();
  const track = useAnalytics();
  const { isSubscribed, reload } = useSubscription();
  const [plan, setPlan] = useState<(typeof PLANS)[number]['id']>('yearly');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    track('paywall_viewed', { video_id: videoId });
  }, [track, videoId]);

  // Once the Stripe webhook marks the subscription active, continue watching.
  useEffect(() => {
    if (!isSubscribed) return;
    if (videoId) router.replace({ pathname: '/watch/[id]', params: { id: videoId } });
    else router.back();
  }, [isSubscribed, videoId]);

  const checkout = async () => {
    setLoading(true);
    track('checkout_started', { plan });
    try {
      // Where Stripe should send the user afterwards (deep link back into the app).
      const returnTo = Linking.createURL('/checkout-return');
      const { url } = await createCheckoutSession(supabase, plan, returnTo);
      if (Platform.OS === 'web') {
        window.location.href = url;
        return;
      }
      await WebBrowser.openAuthSessionAsync(url, returnTo);
      // The webhook may take a moment; poll briefly.
      for (let i = 0; i < 5; i++) {
        reload();
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      Alert.alert('Checkout failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Unlock everything</Text>
      {PERKS.map((perk) => (
        <Text key={perk} style={styles.perk}>
          ✓ {perk}
        </Text>
      ))}

      <View style={styles.plans}>
        {PLANS.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setPlan(p.id)}
            style={[styles.plan, plan === p.id && styles.planSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected: plan === p.id }}
          >
            <Text style={styles.planLabel}>{p.label}</Text>
            <Text style={styles.planPrice}>
              {p.price}
              <Text style={styles.planPeriod}>{p.period}</Text>
            </Text>
            <Text style={styles.planNote}>{p.note}</Text>
          </Pressable>
        ))}
      </View>

      <Button title="Continue to secure checkout" loading={loading} onPress={checkout} />
      <Text style={styles.fine}>Payments are processed securely by Stripe. Subscriptions renew automatically until cancelled.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.md, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { color: colors.text, fontSize: 30, fontWeight: '900', marginBottom: spacing.sm },
  perk: { color: colors.text, fontSize: 16 },
  plans: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.lg },
  plan: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 2, borderColor: colors.border, gap: spacing.xs },
  planSelected: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
  planLabel: { color: colors.textMuted, fontWeight: '700' },
  planPrice: { color: colors.text, fontSize: 24, fontWeight: '900' },
  planPeriod: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  planNote: { color: colors.premium, fontSize: 12, fontWeight: '600' },
  fine: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
});
