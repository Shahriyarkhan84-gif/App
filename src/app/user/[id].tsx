import { useAuth } from '@clerk/clerk-expo';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand, hasFeature, U } from '@/lib/brand';
import { svipProgress } from '@/lib/svip';
import { ContributionsCard } from '@/components/Contributions';
import { FanClubCard } from '@/components/FanClub';
import { PressScale } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Button, compactNumber, glassShadow, IconButton, RoleBadges, Row, Screen, Text, TextTabs } from '@/components/ui';
import { ProfileMedia } from '@/components/ProfileMedia';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { countryName, flag } from '@/lib/country';
import { friendlyError } from '@/lib/errors';
import { useAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { hidesLocation } from '@/lib/privacy';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName, type Profile } from '@/lib/types';
import { shareMessage } from '@/lib/share';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'profile' | 'videos' | 'replays'>('videos');
  const [photoIndex, setPhotoIndex] = useState(0);
  const insets = useSafeAreaInsets();

  const { data, error, loading, reload } = useAsync(async () => {
    const [profile, host, room, followers, follow, followingList, pin, hideLocation, card, photos] = await Promise.all([
      supabase.from('profiles').select('id,user_number,verified_at,owner_verified_at,username,display_name,avatar_url,bio,country,signup_country,language,role,status,status_until,deleted_at,active_frame_id,created_at').eq('id', id).maybeSingle(),
      supabase.from('hosts').select('host_code,total_live_seconds').eq('user_id', id).maybeSingle(),
      supabase.from('rooms').select('id,status,title,viewer_count').eq('host_id', id).maybeSingle(),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', id),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!).eq('followee_id', id).maybeSingle(),
      supabase.from('follows').select('followee_id', { count: 'exact' }).eq('follower_id', id).limit(1000),
      supabase.from('pinned_profiles').select('user_id').eq('user_id', id).maybeSingle(),
      id === userId ? Promise.resolve(false) : hidesLocation(supabase, id),
      // Beans, diamonds, VIP, visitors and agency name (null until 20261031020000_social_profile.sql is applied).
      supabase.rpc('profile_card', { p_user: id }),
      supabase.from('profile_photos').select('id,url').eq('user_id', id).order('position').order('id'),
    ]);
    if (profile.error) throw profile.error;
    if (!profile.data || (profile.data as { deleted_at?: string | null }).deleted_at) return null; // unknown or removed user
    // Friends = people they follow who follow them back.
    const theirFollowees = (followingList.data ?? []).map((f) => f.followee_id);
    const friends = theirFollowees.length
      ? (await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', id).in('follower_id', theirFollowees)).count ?? 0
      : 0;
    return {
      profile: profile.data as Profile, host: host.data, room: room.data, followers: followers.count ?? 0, follows: !!follow.data,
      following: followingList.count ?? 0, friends, pinned: !!pin.data, hideLocation,
      card: (card.error ? null : card.data) as ProfileCardData | null,
      photos: (photos.error ? [] : photos.data ?? []) as { id: number; url: string }[],
    };
  }, [id, userId], `user:${id}`);

  const isMe = id === userId;
  // Counts one visit per viewer per day (never your own).
  useEffect(() => {
    if (id && !isMe) void supabase.rpc('record_profile_view', { p_user: id });
  }, [id, isMe, supabase]);
  const { isPlatformAdmin } = useProfile();
  const [ownerBusy, setOwnerBusy] = useState(false);
  // Shown at once after a change (the refetch catches up), so buttons never show a stale title.
  const [ownerState, setOwnerState] = useState<{ verified?: boolean; pinned?: boolean }>({});
  const ownerVerified = ownerState.verified ?? !!data?.profile.owner_verified_at;
  const ownerPinned = ownerState.pinned ?? !!data?.pinned;
  // Owner-only: the server checks the role too (set_profile_verified / set_profile_pinned).
  const ownerAction = async (fn: string, args: Record<string, unknown>, next: { verified?: boolean; pinned?: boolean }, done: string) => {
    setOwnerBusy(true);
    try {
      await rpc(supabase, fn, { p_user: id, ...args });
      setOwnerState((s) => ({ ...s, ...next }));
      reload();
      Alert.alert(done);
    } catch (e) {
      Alert.alert('Could not update', friendlyError(e));
    } finally {
      setOwnerBusy(false);
    }
  };
  const isFollowing = following ?? data?.follows ?? false;

  const shareProfile = () => {
    if (!data) return;
    void shareMessage(`${displayName(data.profile)} on ${brand.name} — ID ${data.profile.user_number}: ${brand.app.scheme}://user/${id}`);
    track('profile_shared', { user_id: id! });
  };

  const [followBusy, setFollowBusy] = useState(false);
  const toggleFollow = async () => {
    if (followBusy) return;
    setFollowBusy(true);
    const next = !isFollowing;
    setFollowing(next);
    const { error } = next
      ? await supabase.from('follows').insert({ followee_id: id })
      : await supabase.from('follows').delete().eq('follower_id', userId!).eq('followee_id', id);
    if (error) setFollowing(!next);
    else track('follow_toggled', { user_id: id, following: next });
    setFollowBusy(false);
  };

  const moreActions = () =>
    Alert.alert(displayName(data?.profile), undefined, [
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          // block_user also removes follows both ways, so neither of you sees the other's lives in Following.
          try {
            await rpc(supabase, 'block_user', { p_user: id });
            setFollowing(false);
            reload();
            Alert.alert('Blocked', 'You no longer follow each other, and they can no longer message you.');
          } catch (e) {
            Alert.alert('Could not block', friendlyError(e));
          }
        },
      },
      {
        text: 'Report',
        onPress: async () => {
          try {
            await rpc(supabase, 'report_content', { p_target_type: 'user', p_target_id: id, p_reason: 'Reported from profile' });
            track('report_submitted', { target_type: 'user' });
            Alert.alert('Thanks', 'Our moderators will review this account.');
          } catch (e) {
            Alert.alert('Report failed', friendlyError(e));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const tabs = [
    ...(hasFeature('videos') ? [{ id: 'videos' as const, label: 'Videos' }, { id: 'replays' as const, label: 'Lives' }] : []),
    { id: 'profile' as const, label: 'About' },
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  return (
    <Screen edges={[]}>
      {/* No system header: glass buttons float over the cover photo (Figma: App glass kit → Public profile). */}
      <Stack.Screen options={{ headerShown: false }} />
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d === null, empty: { title: "This account doesn't exist", body: "It may have been deleted." } })}>
        {data && (
          <ScrollView contentContainerStyle={{ paddingBottom: isMe ? 40 : insets.bottom + 110 }}>
            {/* Spotlight (Figma: Components → Option 3 · Spotlight): blurred photo backdrop, big centred photo
                with a glowing ring, then everything straight on the sky, no boxes. */}
            {(() => {
              const pics = data.photos.length ? data.photos.map((p) => p.url) : data.profile.avatar_url ? [data.profile.avatar_url] : [];
              const shown = pics[Math.min(photoIndex, pics.length - 1)] ?? null;
              const live = data.room?.status === 'live';
              const vip = data.card ? svipProgress(data.card.diamonds_bought).current : null;
              return (
                <View style={{ alignItems: 'center', paddingTop: insets.top + 64 }}>
                  <View style={[StyleSheet.absoluteFill, { height: insets.top + 300 }]} pointerEvents="none">
                    {shown && <Image source={shown} blurRadius={40} contentFit="cover" style={StyleSheet.absoluteFill} />}
                    <LinearGradient colors={['rgba(186,230,253,0.15)', c.sky[0]]} style={[StyleSheet.absoluteFill, { bottom: -1 }]} />
                  </View>
                  <PressScale scaleTo={0.96} disabled={!live && pics.length < 2}
                    onPress={() => (live ? router.push({ pathname: '/live/[roomId]', params: { roomId: data.room!.id } }) : setPhotoIndex((i) => (i + 1) % pics.length))}
                    accessibilityRole="button" accessibilityLabel={live ? `${displayName(data.profile)} is live, ${data.room!.viewer_count} watching. Watch` : 'Next photo'}>
                    <LinearGradient colors={live ? ['#F43F5E', '#E11D48', '#F43F5E'] : ['#0EA5E9', '#A78BFA', '#0EA5E9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={{ width: 176, height: 176, borderRadius: 88, alignItems: 'center', justifyContent: 'center', shadowColor: live ? '#E11D48' : c.primary, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }}>
                      <View style={{ width: 166, height: 166, borderRadius: 83, borderWidth: 4, borderColor: '#FFFFFF', overflow: 'hidden', backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                        {shown ? <Image source={shown} contentFit="cover" transition={150} style={{ width: '100%', height: '100%' }} /> : <Text variant="display">{displayName(data.profile).slice(0, 1).toUpperCase()}</Text>}
                      </View>
                    </LinearGradient>
                    {live && (
                      <LinearGradient colors={['#F43F5E', '#E11D48']} style={{ position: 'absolute', bottom: -10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 2, borderColor: '#FFFFFF' }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }} />
                        <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>LIVE · {compactNumber(data.room!.viewer_count)}</Text>
                      </LinearGradient>
                    )}
                  </PressScale>
                  {/* More than one photo: dots show which one; tapping the photo shows the next. */}
                  {!live && pics.length > 1 && (
                    <Row gap={5} style={{ marginTop: 10 }}>
                      {pics.map((u, i) => <View key={u} style={{ width: i === photoIndex ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === photoIndex ? c.primary : c.violetBorder }} />)}
                    </Row>
                  )}

                  <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 20, marginTop: live ? 26 : 16, maxWidth: 640, width: '100%' }}>
                    <Row gap={8}>
                      <Text variant="display" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName(data.profile)}</Text>
                      <RoleBadges profile={data.profile} />
                    </Row>
                    <Text variant="bodySmall" muted selectable style={{ textAlign: 'center' }}>
                      ID {data.profile.user_number}{data.profile.username ? ` · @${data.profile.username}` : ''}{data.profile.signup_country && !data.hideLocation ? ` · ${flag(data.profile.signup_country)} ${countryName(data.profile.signup_country)}` : ''}
                    </Text>
                    {data.profile.bio && <Text muted style={{ textAlign: 'center' }}>{data.profile.bio}</Text>}
                    {/* VIP · Host · agency · visitors in one row. */}
                    {data.card && (
                      <Row gap={8} style={{ flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
                        {vip && <LevelChip label={`VIP ${vip.level}`} colors={vip.colors} icon="diamond" />}
                        {data.card.is_host && <LevelChip label="Host" colors={c.accentGradient} icon="mic" />}
                        {data.card.agency && <LevelChip label={`${data.card.agency} agency`} colors={c.goldGradient} icon="business" dark />}
                        <Row gap={5} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.glassFill, borderWidth: 1, borderColor: c.glassEdge }}>
                          <Ionicons name="eye-outline" size={13} color={c.textMuted} />
                          <Text variant="caption" style={{ fontWeight: '700' }}>{compactNumber(data.card.visitors)} visitors</Text>
                        </Row>
                      </Row>
                    )}
                    {/* Numbers straight on the sky, thin dividers. */}
                    <Row gap={0} style={{ alignSelf: 'stretch', marginTop: 14 }}>
                      {[
                        // Moves with the Follow button at once, before the refetch.
                        { label: 'Fans', value: data.followers + (isFollowing === data.follows ? 0 : isFollowing ? 1 : -1) },
                        { label: 'Following', value: data.following },
                        ...(data.card ? [
                          ...(data.card.is_host ? [{ label: U.Earn, value: data.card.beans }] : []),
                          { label: U.Spend, value: data.card.diamonds_sent },
                        ] : [{ label: 'Friends', value: data.friends }]),
                      ].map((st, i) => (
                        <View key={st.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: c.divider }}>
                          <Text variant="h1">{compactNumber(st.value)}</Text>
                          <Text variant="caption" muted numberOfLines={1}>{st.label}</Text>
                        </View>
                      ))}
                    </Row>
                    {isMe && (
                      <Row style={{ alignSelf: 'stretch', marginTop: 14 }}>
                        <Button title="Edit profile" variant="secondary" onPress={() => router.push('/profile-edit')} style={{ flex: 1 }} />
                        <Button title="Share" variant="secondary" onPress={shareProfile} style={{ flex: 1 }} />
                      </Row>
                    )}
                  </View>
                </View>
              );
            })()}
          <View style={{ paddingHorizontal: 16, gap: 14, marginTop: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            {data.host && <ContributionsCard hostId={id!} plain />}

            {isPlatformAdmin && (
              <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
                <Text variant="label">Owner tools</Text>
                <Row>
                  <Button
                    title={ownerVerified ? 'Remove verified' : 'Verify ID'}
                    variant={ownerVerified ? 'secondary' : 'primary'}
                    size="sm"
                    loading={ownerBusy}
                    onPress={() => ownerAction('set_profile_verified', { p_verified: !ownerVerified },
                      ownerVerified ? { verified: false, pinned: false } : { verified: true }, ownerVerified ? 'Verification removed' : 'Account verified')}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title={ownerPinned ? 'Unpin from Home' : 'Pin to Home'}
                    variant="secondary"
                    size="sm"
                    loading={ownerBusy}
                    disabled={!ownerVerified && !ownerPinned}
                    onPress={() => ownerAction('set_profile_pinned', { p_pinned: !ownerPinned }, { pinned: !ownerPinned }, ownerPinned ? 'Removed from Home' : 'Pinned to Home')}
                    style={{ flex: 1 }}
                  />
                </Row>
                {!ownerVerified && <Text variant="caption" muted>Verify the ID first to pin it to Home.</Text>}
              </View>
            )}

            {/* With videos off (brand setting) there is only the About tab (host contributions), so no tab bar. */}
            {tabs.length > 1 && <TextTabs options={tabs} value={activeTab} onChange={setTab} />}
            {activeTab === 'videos' && <ProfileMedia userId={id!} kind="upload" isMe={isMe} />}
            {activeTab === 'replays' && <ProfileMedia userId={id!} kind="live_recording" isMe={isMe} />}
            {activeTab === 'profile' && (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 8 }}>
                  <Text variant="h3">Basic information</Text>
                  <Row gap={8} style={{ flexWrap: 'wrap' }}>
                    {data.profile.signup_country && !data.hideLocation && <InfoChip icon="location-outline" label={`${countryName(data.profile.signup_country)} ${flag(data.profile.signup_country)}`} />}
                    {data.profile.language && <InfoChip icon="language-outline" label={languageName(data.profile.language)} />}
                    {data.profile.created_at && <InfoChip icon="calendar-outline" label={`Joined ${new Date(data.profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`} />}
                  </Row>
                </View>
                {data.host && <FanClubCard hostId={id} isFollowing={isFollowing} />}
              </View>
            )}
          </View>
          </ScrollView>
        )}
      </StateView>
      {/* Follow · Chat · Gift float at the bottom, no bar behind them. */}
      {data && !isMe && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16, flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 608, alignSelf: 'center' }}>
          <Button title={isFollowing ? 'Following' : 'Follow'} variant={isFollowing ? 'secondary' : 'primary'} onPress={toggleFollow} style={{ flex: 1.4 }} />
          <Button title="Chat" variant="secondary" onPress={() => router.push({ pathname: '/chat/[userId]', params: { userId: id } })} style={{ flex: 1 }} />
          {data.room?.status === 'live' && (
            <PressScale onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: data.room!.id } })} scaleTo={0.92} accessibilityRole="button" accessibilityLabel="Send a gift in their live">
              <LinearGradient colors={c.goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', shadowColor: '#B45309', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
                <Ionicons name="gift" size={22} color={c.onGold} />
              </LinearGradient>
            </PressScale>
          )}
        </View>
      )}
      {/* Floating glass buttons over the backdrop. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        {data && (
          <Row gap={10}>
            <IconButton icon="share-outline" label="Share this profile" onPress={shareProfile} />
            {isMe
              ? <IconButton icon="create-outline" label="Edit profile" onPress={() => router.push('/profile-edit')} />
              : <IconButton icon="ellipsis-horizontal" label="More actions" onPress={moreActions} />}
          </Row>
        )}
      </View>
    </Screen>
  );
}

type ProfileCardData = { fans: number; following: number; friends: number; beans: number; diamonds_sent: number; diamonds_bought: number; visitors: number; is_host: boolean; agency: string | null };

/** Small gradient chip for levels (VIP, Host). */
function LevelChip({ label, colors, icon, dark }: { label: string; colors: readonly [string, string, ...string[]]; icon: 'diamond' | 'mic' | 'business'; dark?: boolean }) {
  const fg = dark ? '#2A1A00' : '#FFFFFF';
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
      <Ionicons name={icon} size={12} color={fg} />
      <Text variant="caption" color={fg} style={{ fontWeight: '700' }} numberOfLines={1}>{label}</Text>
    </LinearGradient>
  );
}

/** Glass pill with an icon (Basic information). */
function InfoChip({ icon, label }: { icon: 'location-outline' | 'language-outline' | 'calendar-outline'; label: string }) {
  const { c } = useTheme();
  return (
    <Row gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: c.glassFill, borderWidth: 1, borderColor: c.glassEdge }}>
      <Ionicons name={icon} size={16} color={c.textMuted} />
      <Text>{label}</Text>
    </Row>
  );
}

const LANGUAGES: Record<string, string> = { en: 'English', ur: 'اردو Urdu', hi: 'Hindi', bn: 'Bangla', ar: 'Arabic', id: 'Indonesian', ms: 'Malay', tr: 'Turkish', ne: 'Nepali', tl: 'Filipino' };
function languageName(code: string) {
  return LANGUAGES[code.slice(0, 2).toLowerCase()] ?? code.toUpperCase();
}
