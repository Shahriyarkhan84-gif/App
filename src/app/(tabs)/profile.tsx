import { useClerk, useUser } from '@clerk/clerk-expo';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { useAnalytics } from '@/lib/analytics';
import { createPortalSession } from '@/lib/api';
import { env } from '@/lib/env';
import { useSubscription } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';

export default function ProfileScreen() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const supabase = useSupabase();
  const track = useAnalytics();
  const { subscription, isSubscribed, reload } = useSubscription();
  const [portalLoading, setPortalLoading] = useState(false);

  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const returnTo = Linking.createURL('/profile');
      const { url } = await createPortalSession(supabase, returnTo);
      if (Platform.OS === 'web') window.location.href = url;
      else await WebBrowser.openAuthSessionAsync(url, returnTo);
      reload();
    } catch (e) {
      Alert.alert('Billing unavailable', e instanceof Error ? e.message : 'Please try again later.');
    } finally {
      setPortalLoading(false);
    }
  };

  const openFeedback = async () => {
    if (!env.productBridgeUrl) {
      Alert.alert('Feedback', 'Set EXPO_PUBLIC_PRODUCTBRIDGE_URL to your ProductBridge board.');
      return;
    }
    track('feedback_opened', {});
    await WebBrowser.openBrowserAsync(env.productBridgeUrl);
  };

  const renewal = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString()
    : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          {user?.imageUrl ? <Image source={user.imageUrl} style={styles.avatar} /> : <View style={styles.avatar} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.fullName || 'Streamly member'}</Text>
            <Text style={styles.email}>{user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Membership</Text>
          {isSubscribed ? (
            <>
              <Text style={[styles.plan, { color: colors.premium }]}>Premium</Text>
              {renewal && (
                <Text style={styles.muted}>
                  {subscription?.cancel_at_period_end ? `Ends on ${renewal}` : `Renews on ${renewal}`}
                </Text>
              )}
              <Button title="Manage billing" variant="secondary" loading={portalLoading} onPress={openBillingPortal} />
            </>
          ) : (
            <>
              <Text style={styles.plan}>Free</Text>
              <Text style={styles.muted}>Unlock every title in HD, no ads.</Text>
              <Button title="Go Premium" onPress={() => router.push('/paywall')} />
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Help us improve</Text>
          <Text style={styles.muted}>Request features and vote on ideas.</Text>
          <Button title="Share feedback" variant="secondary" onPress={openFeedback} />
        </View>

        <Button title="Sign out" variant="ghost" onPress={() => signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.sm },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceRaised },
  name: { color: colors.text, fontSize: 20, fontWeight: '800' },
  email: { color: colors.textMuted, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  plan: { color: colors.text, fontSize: 24, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.sm },
});
