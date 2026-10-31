import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Children, isValidElement, type ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarSpace } from '@/components/Menus';
import { StateView } from '@/components/StateView';
import { FadeIn, PressScale } from '@/components/Motion';
import { FramedAvatar } from '@/components/FramedAvatar';
import { AgencyOwnerBadge, Card, compactNumber, glassShadow, GlassSheen, HostBadge, IconButton, Row, Screen, Text, type IconName } from '@/components/ui';
import { hasFeature, U } from '@/lib/brand';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { env } from '@/lib/env';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { appIsDark, useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

export default function ProfileScreen() {
  const tabSpace = useTabBarSpace();
  const supabase = useSupabase();
  const { t } = useI18n();
  const track = useAnalytics();
  const { profile, host, isHost, isPlatformAdmin, error, reload } = useProfile();
  const offline = useOffline();
  const focused = useIsFocused();
  const { c: d } = useTheme();

  // Balances shown beside Wallet and Earnings.
  const stats = useFocusedAsync(async () => {
    if (!profile) return null;
    const [wallet, earnings] = await Promise.all([
      supabase.from('wallets').select('coin_balance').eq('user_id', profile.id).maybeSingle(),
      host ? supabase.from('creator_earnings').select('balance').eq('host_id', profile.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    for (const r of [wallet, earnings]) if (r.error) throw r.error;
    return {
      coins: wallet.data?.coin_balance ?? 0,
      earnings: (earnings.data as { balance: number } | null)?.balance ?? 0,
    };
  }, [profile?.id, !!host], profile ? `me:${profile.id}` : undefined);
  useRealtime('wallets', profile ? `user_id=eq.${profile.id}` : undefined, () => stats.reload(), !!profile);

  const openFeedback = async () => {
    if (!env.productBridgeUrl) return Alert.alert('Feedback', 'Set EXPO_PUBLIC_PRODUCTBRIDGE_URL to your ProductBridge board.');
    track('feedback_opened', {});
    await WebBrowser.openBrowserAsync(env.productBridgeUrl);
  };

  if (!profile) return <Screen><StateView state={offline ? { kind: 'offline', onRetry: reload } : error ? { kind: 'error', error, onRetry: reload } : { kind: 'loading' }} /></Screen>;

  const verified = host?.verification_status === 'approved';
  const isAgencyOwner = profile?.role === 'AGENCY_ADMIN';
  const isAgencyStaff = isAgencyOwner || profile?.role === 'AGENCY_MEMBER';

  // Me (Figma "App glass kit" → Me): edit and settings up top, a compact profile card, then glass menu groups.
  return (
    <View style={{ flex: 1, backgroundColor: d.background }}>
      {focused && <StatusBar style={appIsDark ? 'light' : 'dark'} />}
      <LinearGradient colors={d.sky} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabSpace + 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Row style={{ justifyContent: 'space-between', paddingTop: 4 }}>
            <IconButton icon="create-outline" label="Edit profile" onPress={() => router.push('/profile-edit')} />
            <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
          </Row>

          <FadeIn>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
              <View>
                <Pressable onPress={() => router.push({ pathname: '/user/[id]', params: { id: profile.id } })} accessibilityRole="button" accessibilityLabel="View your profile">
                  <FramedAvatar uri={profile.avatar_url} name={displayName(profile)} size={76} ring={d.primary} frameId={profile.active_frame_id} />
                </Pressable>
                {/* Frame button on the photo: opens the frames shop to pick or change a frame. */}
                {hasFeature('frames') && (
                  <Pressable onPress={() => router.push('/frames')} accessibilityRole="button" accessibilityLabel="Profile frame" hitSlop={8}
                    style={{ position: 'absolute', right: -4, bottom: -4, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: d.primary, borderWidth: 2, borderColor: d.surfaceRaised }}>
                    <Ionicons name="sparkles" size={13} color={d.primaryText} />
                  </Pressable>
                )}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Row gap={6}>
                  <Text variant="h1" color={d.text} numberOfLines={1} style={{ flexShrink: 1 }}>{displayName(profile)}</Text>
                  {verified && <HostBadge />}
                </Row>
                <Text variant="bodySmall" color={d.textMuted} selectable accessibilityLabel={`Your ID ${String(profile.user_number).split('').join(' ')}`}>ID {profile.user_number}</Text>
                {(isAgencyOwner || (host && !verified)) && (
                  <Row gap={6} style={{ flexWrap: 'wrap' }}>
                    {host && !verified && <Badge label={host.verification_status === 'declined' ? 'Verification declined' : host.verification_status === 'unverified' ? 'Not verified' : 'Verification pending'} />}
                    {isAgencyOwner && <AgencyOwnerBadge small />}
                  </Row>
                )}
                <Pressable onPress={() => router.push({ pathname: '/user/[id]', params: { id: profile.id } })} accessibilityRole="link" hitSlop={8}>
                  <Text variant="label" color={d.primary}>View profile ›</Text>
                </Pressable>
              </View>
            </Card>
          </FadeIn>

          {profile.status !== 'active' && (
            <View style={{ padding: 14, borderRadius: 16, borderWidth: 1, borderColor: d.warning, gap: 4, backgroundColor: d.glassFill }}>
              <Text variant="label" color={d.warning}>Account {profile.status}</Text>
              <Text color={d.textMuted}>{profile.status_until ? `Until ${new Date(profile.status_until).toLocaleString()}` : 'Contact support for details.'}</Text>
            </View>
          )}

          <FadeIn delay={60}>
            <Group>
              {isHost
                ? <MenuRow icon="trending-up-outline" label="Creator Center" onPress={() => router.push('/host/dashboard')} />
                : <MenuRow icon="trending-up-outline" label="Creator Center" detail="Become a host" onPress={() => router.push('/hosting')} />}
              {isHost && !verified && <MenuRow icon="shield-checkmark-outline" label={t('menu.hostingVerification')} onPress={() => router.push('/hosting')} />}
              {hasFeature('events') && <MenuRow icon="megaphone-outline" label="Event Center" onPress={() => router.push('/events')} />}
            </Group>
          </FadeIn>

          <FadeIn delay={110}>
            <Group>
              <MenuRow icon="wallet-outline" label="Wallet" detail={stats.data ? `${compactNumber(stats.data.coins)} ${U.spend}` : undefined} onPress={() => router.push('/wallet')} />
              {host && <MenuRow icon="cash-outline" label="Earnings" detail={stats.data ? `${compactNumber(stats.data.earnings)} ${U.earn}` : undefined} onPress={() => router.push('/earnings')} />}
              {hasFeature('frames') && <MenuRow icon="briefcase-outline" label={t('menu.itemBag')} onPress={() => router.push('/item-bag')} />}
              {hasFeature('videos') && <MenuRow icon="create-outline" label="Post" detail="Share a video" onPress={() => router.push('/videos/upload')} />}
            </Group>
          </FadeIn>

          <FadeIn delay={160}>
            <Group>
              <MenuRow icon="diamond-outline" label={t('menu.svip')} onPress={() => router.push('/svip')} />
              <MenuRow icon="checkbox-outline" label={t('menu.tasks')} onPress={() => router.push('/tasks')} />
              <MenuRow icon="heart-outline" label="Fans group" onPress={() => router.push('/fans')} />
              {hasFeature('rankings') && <MenuRow icon="podium-outline" label={t('menu.rankings')} onPress={() => router.push('/rankings')} />}
              {hasFeature('videos') && <MenuRow icon="play-circle-outline" label={t('menu.videos')} onPress={() => router.push('/videos')} />}
            </Group>
          </FadeIn>

          <FadeIn delay={210}>
            <Group>
              <MenuRow icon="help-buoy-outline" label={t('menu.support')} onPress={() => router.push('/support')} />
              {/* Only when a feedback board is configured; otherwise the row would just show a setup message. */}
              {!!env.productBridgeUrl && <MenuRow icon="chatbubble-ellipses-outline" label={t('menu.feedback')} onPress={openFeedback} />}
              {isAgencyStaff && hasFeature('agencies') && <MenuRow icon="business-outline" label={t('menu.agency')} onPress={() => router.push('/agency')} />}
              {!isAgencyStaff && hasFeature('agencies') && <MenuRow icon="business-outline" label="Join an agency" onPress={() => router.push('/hosting')} />}
              {isPlatformAdmin && <MenuRow icon="analytics-outline" label={t('menu.admin')} onPress={() => router.push('/admin')} />}
            </Group>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** A frosted glass group of menu rows; dividers between rows, none after the last. */
function Group({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ borderRadius: 22, backgroundColor: c.glassFill, borderWidth: 1, borderColor: c.glassEdge, ...glassShadow }}>
      <GlassSheen radius={22} />
      {rows.map((r, i) => (
        <View key={i}>
          {r}
          {i < rows.length - 1 && <View style={{ height: 1, marginLeft: 64, backgroundColor: c.divider }} />}
        </View>
      ))}
    </View>
  );
}

/** Menu row (kit "List row"): tinted icon tile, label, optional detail, chevron. */
function MenuRow({ icon, label, detail, onPress }: { icon: IconName; label: string; detail?: string; onPress: () => void }) {
  const { c: d } = useTheme();
  return (
    <PressScale onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label}>
      <Row gap={14} style={{ paddingHorizontal: 14, minHeight: 56 }}>
        <LinearGradient colors={[d.violetSurface, d.violetBorder]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={19} color={d.primary} />
        </LinearGradient>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '500' }} color={d.text} numberOfLines={1}>{label}</Text>
        {detail && <Text variant="bodySmall" color={d.textMuted} numberOfLines={1}>{detail}</Text>}
        <Ionicons name="chevron-forward" size={18} color={d.textFaint} />
      </Row>
    </PressScale>
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
