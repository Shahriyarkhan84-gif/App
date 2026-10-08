import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarSpace } from '@/components/Menus';
import { StateView } from '@/components/StateView';
import { FadeIn, PressScale } from '@/components/Motion';
import { FramedAvatar } from '@/components/FramedAvatar';
import { AgencyOwnerBadge, Coin, compactNumber, HostBadge, IconButton, Row, Screen, Text, type IconName } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { env } from '@/lib/env';
import { useFocusedAsync, useRealtime } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { liveColors, useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

export default function ProfileScreen() {
  const tabSpace = useTabBarSpace();
  const supabase = useSupabase();
  const { t } = useI18n();
  const track = useAnalytics();
  const { profile, host, isHost, isPlatformAdmin, error, reload } = useProfile();
  const focused = useIsFocused();

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
  const d = liveColors;

  // Dark "Me" page in the style of other live apps: centred framed photo, stats, four tiles, grouped rows.
  return (
    <View style={{ flex: 1, backgroundColor: d.background }}>
      {focused && <StatusBar style="light" />}
      <LinearGradient colors={['#2B1550', d.background]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 360 }} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabSpace + 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <IconButton icon="settings-outline" label="Settings" color={d.text} bg="rgba(255,255,255,0.08)" onPress={() => router.push('/settings')} />
            <IconButton icon="create-outline" label="Edit profile" color={d.text} bg="rgba(255,255,255,0.08)" onPress={() => router.push('/profile-edit')} />
          </Row>

          <FadeIn style={{ alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => router.push('/frames')} accessibilityRole="button" accessibilityLabel="Profile frames">
              <FramedAvatar uri={profile.avatar_url} name={displayName(profile)} size={116} ring={d.primary} frameId={profile.active_frame_id} />
            </Pressable>
            <Text variant="h1" color={d.text} style={{ textAlign: 'center', marginTop: 6 }} numberOfLines={1}>{displayName(profile)}</Text>
            <Text variant="bodySmall" color={d.textMuted} selectable accessibilityLabel={`Your ID ${String(profile.user_number).split('').join(' ')}`}>ID {profile.user_number}</Text>
            {(host || isAgencyOwner) && (
              <Row gap={6} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                {host && (verified ? <HostBadge /> : <Badge label={host.verification_status === 'declined' ? 'Verification declined' : host.verification_status === 'unverified' ? 'Not verified' : 'Verification pending'} />)}
                {isAgencyOwner && <AgencyOwnerBadge />}
              </Row>
            )}
            {profile.bio && <Text color={d.textMuted} style={{ textAlign: 'center' }}>{profile.bio}</Text>}
          </FadeIn>

          {profile.status !== 'active' && (
            <View style={{ padding: 14, borderRadius: 16, borderWidth: 1, borderColor: d.warning, gap: 4 }}>
              <Text variant="label" color={d.warning}>Account {profile.status}</Text>
              <Text color={d.textMuted}>{profile.status_until ? `Until ${new Date(profile.status_until).toLocaleString()}` : 'Contact support for details.'}</Text>
            </View>
          )}

          <FadeIn delay={80} style={{ flexDirection: 'row' }}>
            <Stat label="Friends" value={stats.data?.friends} />
            <Stat label="Following" value={stats.data?.following} />
            <Stat label="Fans" value={stats.data?.followers} />
          </FadeIn>

          <FadeIn delay={140} style={{ flexDirection: 'row', gap: 8 }}>
            <Tile coin iconColor="#FFC24B" label={stats.data ? compactNumber(stats.data.coins) : '–'} sub="Coins" tint={['#3A2A0E', '#241708']} labelColor="#FFE3A3" onPress={() => router.push('/wallet')} />
            <Tile icon="sparkles" iconColor="#F0ABFC" label="Frames" sub="Shop" tint={['#3B1D5E', '#24133D']} labelColor="#F5D0FE" onPress={() => router.push('/frames')} />
            <Tile icon="business" iconColor="#FDBA74" label="Agency" sub={isAgencyStaff ? 'Portal' : 'Join'} tint={['#3A2412', '#24160B']} labelColor="#FED7AA" onPress={() => router.push(isAgencyStaff ? '/agency' : '/hosting')} />
            <Tile icon="diamond" iconColor="#93C5FD" label={host && stats.data ? compactNumber(stats.data.earnings) : 'Earn'} sub={host ? 'Diamonds' : 'Money'} tint={['#16264A', '#0E1830']} labelColor="#BFDBFE" onPress={() => router.push(host ? '/earnings' : '/hosting')} />
          </FadeIn>

          <FadeIn delay={200}>
            <Group>
              {isHost && <DarkRow icon="trending-up" tint="#2DD4BF" label="Creator Center" onPress={() => router.push('/host/dashboard')} />}
              <DarkRow icon="megaphone" tint="#22D3EE" label={t('menu.events')} onPress={() => router.push('/events')} />
              <DarkRow icon="trophy" tint="#FBBF24" label={t('menu.rankings')} onPress={() => router.push('/rankings')} last />
            </Group>
          </FadeIn>

          <FadeIn delay={240}>
            <Group>
              <DarkRow icon="wallet" tint="#F472B6" label="Wallet" detail={stats.data ? `${stats.data.coins.toLocaleString()} coins` : undefined} onPress={() => router.push('/wallet')} />
              <DarkRow icon="sparkles" tint="#C084FC" label="Profile frames" onPress={() => router.push('/frames')} />
              <DarkRow icon="play-circle" tint="#FB923C" label={t('menu.videos')} onPress={() => router.push('/videos')} last={verified} />
              {!verified && <DarkRow icon="shield-checkmark" tint="#FACC15" label={t('menu.hostingVerification')} onPress={() => router.push('/hosting')} last />}
            </Group>
          </FadeIn>

          <FadeIn delay={280}>
            <Group>
              <DarkRow icon="help-buoy" tint="#60A5FA" label={t('menu.support')} onPress={() => router.push('/support')} last={!env.productBridgeUrl && !isAgencyStaff && !isPlatformAdmin} />
              {/* Only when a feedback board is configured; otherwise the row would just show a setup message. */}
              {!!env.productBridgeUrl && <DarkRow icon="chatbubble-ellipses" tint="#34D399" label={t('menu.feedback')} onPress={openFeedback} last={!isAgencyStaff && !isPlatformAdmin} />}
              {isAgencyStaff && <DarkRow icon="business" tint="#FDBA74" label={t('menu.agency')} onPress={() => router.push('/agency')} last={!isPlatformAdmin} />}
              {isPlatformAdmin && <DarkRow icon="analytics" tint="#A78BFA" label={t('menu.admin')} onPress={() => router.push('/admin')} last />}
            </Group>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** One of the four coloured tiles under the stats. */
function Tile({ icon, coin, iconColor, label, sub, tint, labelColor, onPress }: {
  icon?: IconName; coin?: boolean; iconColor: string; label: string; sub: string; tint: [string, string]; labelColor: string; onPress: () => void;
}) {
  return (
    <PressScale onPress={onPress} scaleTo={0.95} accessibilityRole="button" accessibilityLabel={`${label} ${sub}`} style={{ flex: 1 }}>
      <LinearGradient colors={tint} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ minHeight: 104, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
          {coin ? <Coin size={26} /> : icon && <Ionicons name={icon} size={24} color={iconColor} />}
        </View>
        <Text variant="label" color={labelColor} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
        <Text variant="caption" color="rgba(255,255,255,0.55)" numberOfLines={1}>{sub}</Text>
      </LinearGradient>
    </PressScale>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <View style={{ borderRadius: 18, backgroundColor: liveColors.surface, overflow: 'hidden' }}>{children}</View>;
}

/** Menu row: coloured round icon, label, optional detail, chevron. */
function DarkRow({ icon, tint, label, detail, onPress, last }: { icon: IconName; tint: string; label: string; detail?: string; onPress: () => void; last?: boolean }) {
  const d = liveColors;
  return (
    <PressScale onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label}>
      <Row gap={14} style={{ paddingHorizontal: 14, minHeight: 60, borderBottomWidth: last ? 0 : 1, borderBottomColor: d.divider }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={20} color="#fff" />
        </View>
        <Text style={{ flex: 1, fontSize: 16 }} color={d.text}>{label}</Text>
        {detail && <Text variant="bodySmall" color={d.textMuted}>{detail}</Text>}
        <Ionicons name="chevron-forward" size={18} color={d.textFaint} />
      </Row>
    </PressScale>
  );
}

function Badge({ label, gold }: { label: string; gold?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: gold ? c.gold : liveColors.surfaceRaised }}>
      <Text variant="caption" color={gold ? c.onGold : liveColors.textMuted} style={{ fontSize: 11, fontWeight: gold ? '700' : '500' }}>{label}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  const d = liveColors;
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text variant="display" color={d.text} style={{ fontSize: 24, lineHeight: 30 }}>{value === undefined ? '–' : compactNumber(value)}</Text>
      <Text variant="bodySmall" color={d.textMuted}>{label}</Text>
    </View>
  );
}
