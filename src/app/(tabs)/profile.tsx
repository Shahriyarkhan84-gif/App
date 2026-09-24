import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, ScrollView, View } from 'react-native';

import { StateView } from '@/components/StateView';
import { Avatar, Button, Card, Coin, HostBadge, IconButton, ListRow, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { env } from '@/lib/env';
import { useFocusedAsync, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

export default function ProfileScreen() {
  const supabase = useSupabase();
  const { signOut } = useClerk();
  const { c } = useTheme();
  const track = useAnalytics();
  const { profile, host, isHost, isPlatformAdmin, error, reload } = useProfile();

  const stats = useFocusedAsync(async () => {
    if (!profile) return null;
    const [followers, following, wallet, earnings] = await Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', profile.id),
      supabase.from('follows').select('followee_id', { count: 'exact' }).eq('follower_id', profile.id).limit(1000),
      supabase.from('wallets').select('coin_balance').eq('user_id', profile.id).maybeSingle(),
      isHost ? supabase.from('creator_earnings').select('balance').eq('host_id', profile.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    // Friends = people you follow who follow you back.
    const followeeIds = (following.data ?? []).map((f) => f.followee_id);
    const friends = followeeIds.length
      ? (await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', profile.id).in('follower_id', followeeIds)).count ?? 0
      : 0;
    return {
      friends,
      followers: followers.count ?? 0,
      following: following.count ?? 0,
      coins: wallet.data?.coin_balance ?? 0,
      earnings: (earnings.data as { balance: number } | null)?.balance ?? 0,
    };
  }, [profile?.id, isHost]);
  useRealtime('wallets', profile ? `user_id=eq.${profile.id}` : undefined, () => stats.reload(), !!profile);

  const openFeedback = async () => {
    if (!env.productBridgeUrl) return Alert.alert('Feedback', 'Set EXPO_PUBLIC_PRODUCTBRIDGE_URL to your ProductBridge board.');
    track('feedback_opened', {});
    await WebBrowser.openBrowserAsync(env.productBridgeUrl);
  };

  if (!profile) return <Screen><StateView state={error ? { kind: 'error', error, onRetry: reload } : { kind: 'loading' }} /></Screen>;

  const verified = host?.verification_status === 'approved';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h2">Me</Text>
          <IconButton icon="create-outline" label="Edit profile" onPress={() => router.push('/profile-edit')} />
        </Row>

        <Row gap={14}>
          <Avatar uri={profile.avatar_url} name={displayName(profile)} size={76} ring={c.primary} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="h3" style={{ fontSize: 20, lineHeight: 26 }} numberOfLines={1}>{displayName(profile)}</Text>
            <Text variant="bodySmall" muted selectable accessibilityLabel={`Your ID ${String(profile.user_number).split('').join(' ')}`}>ID {profile.user_number}</Text>
            {host && (
              <Row gap={6}>
                {verified ? <HostBadge /> : <Badge label="Verification pending" />}
              </Row>
            )}
          </View>
        </Row>
        {profile.bio && <Text muted>{profile.bio}</Text>}
        {profile.status !== 'active' && (
          <Card style={{ borderColor: c.warning }}>
            <Text variant="label" color={c.warning}>Account {profile.status}</Text>
            <Text muted>{profile.status_until ? `Until ${new Date(profile.status_until).toLocaleString()}` : 'Contact support for details.'}</Text>
          </Card>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat label="Friends" value={stats.data?.friends} />
          <Stat label="Followers" value={stats.data?.followers} />
          <Stat label="Following" value={stats.data?.following} />
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, padding: 16, borderRadius: 18, backgroundColor: c.goldSurface, borderWidth: 1, borderColor: c.goldBorder, gap: 10 }}>
            <Row gap={6}><Coin /><Text variant="bodySmall" color={c.goldText}>Coins</Text></Row>
            <Text variant="h1">{stats.data ? stats.data.coins.toLocaleString() : '–'}</Text>
            <Button title="Recharge" variant="gold" size="sm" onPress={() => router.push('/wallet')} />
          </View>
          {isHost && (
            <View style={{ flex: 1, padding: 16, borderRadius: 18, backgroundColor: c.violetSurface, borderWidth: 1, borderColor: c.violetBorder, gap: 10 }}>
              <Row gap={6}><Ionicons name="diamond-outline" size={16} color={c.violetText} /><Text variant="bodySmall" color={c.violetText}>Earnings</Text></Row>
              <Text variant="h1">{stats.data ? stats.data.earnings.toLocaleString() : '–'}</Text>
              <Button title="Withdraw" variant="outline" size="sm" onPress={() => router.push('/earnings')} />
            </View>
          )}
        </View>

        <View style={{ borderRadius: 18, backgroundColor: c.surface, overflow: 'hidden' }}>
          {!verified && <ListRow icon="shield-checkmark-outline" label="Verification for hosting" color={c.gold} onPress={() => router.push('/hosting')} />}
          <ListRow icon="wallet-outline" label="Wallet & history" onPress={() => router.push('/wallet')} />
          <ListRow icon="trophy-outline" label="Rankings" onPress={() => router.push('/rankings')} />
          <ListRow icon="help-buoy-outline" label="Help & support" onPress={() => router.push('/support')} />
          <ListRow icon="megaphone-outline" label="Share feedback" onPress={openFeedback} />
          <ListRow icon="lock-closed-outline" label="Privacy policy" onPress={() => router.push('/privacy')} last={!isPlatformAdmin} />
          {isPlatformAdmin && <ListRow icon="analytics-outline" label="Owner command center" onPress={() => router.push('/admin')} last />}
        </View>

        <Button title="Sign out" variant="ghost" onPress={() => signOut()} />
        <Button title="Delete account" variant="ghost" onPress={() => router.push('/delete-account')} />
      </ScrollView>
    </Screen>
  );
}

function Badge({ label, gold }: { label: string; gold?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: gold ? c.gold : c.surfaceRaised }}>
      <Text variant="caption" color={gold ? c.onGold : c.textMuted} style={{ fontSize: 11, fontWeight: gold ? '700' : '500' }}>{label}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: c.surface, alignItems: 'center', gap: 2 }}>
      <Text variant="h3">{value === undefined ? '–' : value.toLocaleString()}</Text>
      <Text variant="caption" muted>{label}</Text>
    </View>
  );
}
