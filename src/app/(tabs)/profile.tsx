import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ComponentProps } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { StateView } from '@/components/StateView';
import { Avatar, Button, Card, Row, Screen, Text } from '@/components/ui';
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
    const [followers, following, wallet] = await Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', profile.id),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
      supabase.from('wallets').select('coin_balance').eq('user_id', profile.id).maybeSingle(),
    ]);
    return { followers: followers.count ?? 0, following: following.count ?? 0, coins: wallet.data?.coin_balance ?? 0 };
  }, [profile?.id]);
  useRealtime('wallets', profile ? `user_id=eq.${profile.id}` : undefined, () => stats.reload(), !!profile);

  const openFeedback = async () => {
    if (!env.productBridgeUrl) return Alert.alert('Feedback', 'Set EXPO_PUBLIC_PRODUCTBRIDGE_URL to your ProductBridge board.');
    track('feedback_opened', {});
    await WebBrowser.openBrowserAsync(env.productBridgeUrl);
  };

  if (!profile) return <Screen><StateView state={error ? { kind: 'error', error, onRetry: reload } : { kind: 'loading' }} /></Screen>;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Row gap={16}>
          <Avatar uri={profile.avatar_url} name={displayName(profile)} size={72} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="h2">{displayName(profile)}</Text>
            {profile.username && <Text muted>@{profile.username}</Text>}
            {host && <Text variant="caption" color={c.primary}>{host.host_code}</Text>}
          </View>
          <Button title="Edit" size="sm" variant="secondary" onPress={() => router.push('/profile-edit')} />
        </Row>
        {profile.bio && <Text>{profile.bio}</Text>}
        {profile.status !== 'active' && (
          <Card style={{ borderColor: c.warning }}>
            <Text variant="label" color={c.warning}>Account {profile.status}</Text>
            <Text muted>{profile.status_until ? `Until ${new Date(profile.status_until).toLocaleString()}` : 'Contact support for details.'}</Text>
          </Card>
        )}
        <Row style={{ justifyContent: 'space-around' }}>
          <Stat label="Followers" value={stats.data?.followers} />
          <Stat label="Following" value={stats.data?.following} />
          <Stat label="Coins" value={stats.data?.coins} />
        </Row>

        <Card style={{ padding: 0, gap: 0 }}>
          <MenuItem icon="wallet" label="Wallet" href="/wallet" />
          {isHost && <MenuItem icon="diamond" label="Earnings & withdrawals" href="/earnings" />}
          <MenuItem icon="help-buoy" label="Help & support" href="/support" />
          <MenuItem icon="megaphone" label="Share feedback" onPress={openFeedback} />
          {isPlatformAdmin && <MenuItem icon="analytics" label="Owner command center" href="/admin" />}
        </Card>

        <Button title="Sign out" variant="ghost" onPress={() => signOut()} />
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="h3">{value === undefined ? '–' : value.toLocaleString()}</Text>
      <Text variant="caption" muted>{label}</Text>
    </View>
  );
}

function MenuItem({ icon, label, href, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; href?: Href; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress ?? (() => href && router.push(href))} accessibilityRole="button" style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Row>
        <Ionicons name={icon} size={20} color={c.primary} />
        <Text style={{ flex: 1 }}>{label}</Text>
        <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
      </Row>
    </Pressable>
  );
}
