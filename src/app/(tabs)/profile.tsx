import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, View } from 'react-native';

import { useTabBarSpace } from '@/components/Menus';
import { StateView } from '@/components/StateView';
import { FadeIn } from '@/components/Motion';
import { FramedAvatar } from '@/components/FramedAvatar';
import { AgencyOwnerBadge, Button, Card, Coin, compactNumber, HostBadge, IconButton, ListRow, Row, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { env } from '@/lib/env';
import { useFocusedAsync, useRealtime } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

export default function ProfileScreen() {
  const tabSpace = useTabBarSpace();
  const supabase = useSupabase();
  const { c } = useTheme();
  const { t } = useI18n();
  const track = useAnalytics();
  const { profile, host, isHost, isPlatformAdmin, error, reload } = useProfile();

  const stats = useFocusedAsync(async () => {
    if (!profile) return null;
    const [followers, following, wallet, earnings] = await Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', profile.id),
      supabase.from('follows').select('followee_id', { count: 'exact' }).eq('follower_id', profile.id).limit(1000),
      supabase.from('wallets').select('coin_balance').eq('user_id', profile.id).maybeSingle(),
      host ? supabase.from('creator_earnings').select('lifetime').eq('host_id', profile.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    for (const r of [followers, following, wallet, earnings]) if (r.error) throw r.error;
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
      // Diamonds earned = everything ever earned, not just what's withdrawable right now.
      earnings: (earnings.data as { lifetime: number } | null)?.lifetime ?? 0,
    };
  }, [profile?.id, !!host], profile ? `me:${profile.id}` : undefined);
  useRealtime('wallets', profile ? `user_id=eq.${profile.id}` : undefined, () => stats.reload(), !!profile);

  const openFeedback = async () => {
    if (!env.productBridgeUrl) return Alert.alert('Feedback', 'Set EXPO_PUBLIC_PRODUCTBRIDGE_URL to your ProductBridge board.');
    track('feedback_opened', {});
    await WebBrowser.openBrowserAsync(env.productBridgeUrl);
  };

  if (!profile) return <Screen><StateView state={error ? { kind: 'error', error, onRetry: reload } : { kind: 'loading' }} /></Screen>;

  const verified = host?.verification_status === 'approved';
  const isAgencyOwner = profile?.role === 'AGENCY_ADMIN';
  const isAgencyStaff = isAgencyOwner || profile?.role === 'AGENCY_MEMBER';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: tabSpace + 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton icon="create-outline" label="Edit profile" onPress={() => router.push('/profile-edit')} />
          <Text variant="h2">Me</Text>
          <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
        </Row>

        <Row gap={14}>
          <FramedAvatar uri={profile.avatar_url} name={displayName(profile)} size={76} ring={c.primary} frameId={profile.active_frame_id} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="h3" style={{ fontSize: 20, lineHeight: 26 }} numberOfLines={1}>{displayName(profile)}</Text>
            <Text variant="bodySmall" muted selectable accessibilityLabel={`Your ID ${String(profile.user_number).split('').join(' ')}`}>ID {profile.user_number}</Text>
            {(host || isAgencyOwner) && (
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                {host && (verified ? <HostBadge /> : <Badge label={host.verification_status === 'declined' ? 'Verification declined' : host.verification_status === 'unverified' ? 'Not verified' : 'Verification pending'} />)}
                {isAgencyOwner && <AgencyOwnerBadge />}
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

        <FadeIn delay={80} style={{ flexDirection: 'row', gap: 8 }}>
          <Stat label="Following" value={stats.data?.following} />
          <Stat label="Fans" value={stats.data?.followers} />
          <Stat label="Friends" value={stats.data?.friends} />
        </FadeIn>

        <FadeIn delay={160} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, padding: 16, borderRadius: 18, backgroundColor: c.goldSurface, borderWidth: 1, borderColor: c.goldBorder, gap: 10 }}>
            <Row gap={6}><Coin /><Text variant="bodySmall" color={c.goldText}>Coins</Text></Row>
            <Text variant="h1">{stats.data ? stats.data.coins.toLocaleString() : '–'}</Text>
            <Button title="Recharge" variant="gold" size="sm" onPress={() => router.push('/wallet')} />
          </View>
          <View style={{ flex: 1, padding: 16, borderRadius: 18, backgroundColor: c.violetSurface, borderWidth: 1, borderColor: c.violetBorder, gap: 10 }}>
            <Row gap={6}><Ionicons name="diamond-outline" size={16} color={c.violetText} /><Text variant="bodySmall" color={c.violetText}>Diamonds earned</Text></Row>
            <Text variant="h1">{host ? (stats.data ? stats.data.earnings.toLocaleString() : '–') : '0'}</Text>
            {host
              ? <Button title="Withdraw" variant="outline" size="sm" onPress={() => router.push('/earnings')} />
              : <Button title="Become a host" variant="outline" size="sm" onPress={() => router.push('/hosting')} />}
          </View>
        </FadeIn>

        <FadeIn delay={240} style={{ borderRadius: 18, backgroundColor: c.surface, overflow: 'hidden' }}>
          {isHost && <ListRow icon="grid-outline" label="Host dashboard" onPress={() => router.push('/host/dashboard')} />}
          {!verified && <ListRow icon="shield-checkmark-outline" label={t('menu.hostingVerification')} color={c.gold} onPress={() => router.push('/hosting')} />}
          <ListRow icon="wallet-outline" label="Wallet & transactions" onPress={() => router.push('/wallet')} />
          <ListRow icon="sparkles-outline" label="Profile frames" color={c.gold} onPress={() => router.push('/frames')} />
          <ListRow icon="play-circle-outline" label={t('menu.videos')} onPress={() => router.push('/videos')} />
          <ListRow icon="trophy-outline" label={t('menu.rankings')} onPress={() => router.push('/rankings')} />
          <ListRow icon="calendar-outline" label={t('menu.events')} onPress={() => router.push('/events')} />
          <ListRow icon="help-buoy-outline" label={t('menu.support')} onPress={() => router.push('/support')} />
          {/* Only when a feedback board is configured; otherwise the row would just show a setup message. */}
          {!!env.productBridgeUrl && <ListRow icon="megaphone-outline" label={t('menu.feedback')} onPress={openFeedback} last={!isAgencyStaff && !isPlatformAdmin} />}
          {isAgencyStaff && <ListRow icon="business-outline" label={t('menu.agency')} color={c.gold} onPress={() => router.push('/agency')} last={!isPlatformAdmin} />}
          {isPlatformAdmin && <ListRow icon="analytics-outline" label={t('menu.admin')} onPress={() => router.push('/admin')} last />}
        </FadeIn>
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
    <View style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 12, borderRadius: 14, backgroundColor: c.surface }}>
      <Text variant="display" style={{ fontSize: 18, lineHeight: 24 }}>{value === undefined ? '–' : compactNumber(value)}</Text>
      <Text variant="caption" muted>{label}</Text>
    </View>
  );
}
