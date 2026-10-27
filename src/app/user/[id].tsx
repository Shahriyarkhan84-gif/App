import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { brand, hasFeature } from '@/lib/brand';
import { ContributionsCard } from '@/components/Contributions';
import { LiveAvatar } from '@/components/FollowingLive';
import { PressScale } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { FramedAvatar } from '@/components/FramedAvatar';
import { Button, Card, compactNumber, glassShadow, LiveBadge, RoleBadges, Row, Screen, Text, TextTabs } from '@/components/ui';
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
  const [tab, setTab] = useState<'videos' | 'replays' | 'about'>('videos');

  const { data, error, loading, reload } = useAsync(async () => {
    const [profile, host, room, followers, follow, followingList, pin, hideLocation] = await Promise.all([
      supabase.from('profiles').select('id,user_number,verified_at,owner_verified_at,username,display_name,avatar_url,bio,country,signup_country,language,role,status,status_until,deleted_at,active_frame_id').eq('id', id).maybeSingle(),
      supabase.from('hosts').select('host_code,total_live_seconds').eq('user_id', id).maybeSingle(),
      supabase.from('rooms').select('id,status,title,viewer_count').eq('host_id', id).maybeSingle(),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', id),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!).eq('followee_id', id).maybeSingle(),
      supabase.from('follows').select('followee_id', { count: 'exact' }).eq('follower_id', id).limit(1000),
      supabase.from('pinned_profiles').select('user_id').eq('user_id', id).maybeSingle(),
      id === userId ? Promise.resolve(false) : hidesLocation(supabase, id),
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
    };
  }, [id, userId], `user:${id}`);

  const isMe = id === userId;
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
    { id: 'about' as const, label: 'About' },
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: data ? () => (
            <Row gap={18}>
              <PressScale onPress={shareProfile} accessibilityRole="button" accessibilityLabel="Share this profile" hitSlop={12}>
                <Ionicons name="share-social-outline" size={21} color={c.text} />
              </PressScale>
              {/* Your own profile: pencil in the top-right corner opens Edit profile. */}
              {isMe && (
                <PressScale onPress={() => router.push('/profile-edit')} accessibilityRole="button" accessibilityLabel="Edit profile" hitSlop={12}>
                  <Ionicons name="create-outline" size={22} color={c.text} />
                </PressScale>
              )}
            </Row>
          ) : undefined,
        }}
      />
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d === null, empty: { title: "This account doesn't exist", body: "It may have been deleted." } })}>
        {data && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            {/* Social profile: cover, photo, name, counts, actions, then their videos, lives and about. */}
            <Card style={{ padding: 0, gap: 0, borderRadius: 28, overflow: 'hidden' }}>
              <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 96 }} />
              <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 18, marginTop: -54 }}>
                {data.room?.status === 'live' ? (
                  <PressScale
                    scaleTo={0.94}
                    onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: data.room!.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName(data.profile)} is live, ${data.room.viewer_count} watching. Watch`}
                  >
                    <LiveAvatar uri={data.profile.avatar_url} name={displayName(data.profile)} size={108} />
                  </PressScale>
                ) : (
                  <FramedAvatar uri={data.profile.avatar_url} name={displayName(data.profile)} size={100} ring={c.surfaceRaised} frameId={data.profile.active_frame_id} />
                )}
                <Row gap={8}>
                  <Text variant="h2" numberOfLines={1} style={{ maxWidth: 260 }}>{displayName(data.profile)}</Text>
                  <RoleBadges profile={data.profile} />
                </Row>
                <Text variant="caption" faint selectable>
                  ID {data.profile.user_number}{data.profile.username ? ` · @${data.profile.username}` : ''}{data.profile.signup_country && !data.hideLocation ? ` · ${flag(data.profile.signup_country)} ${countryName(data.profile.signup_country)}` : ''}
                </Text>
                {data.profile.bio && <Text muted style={{ textAlign: 'center' }}>{data.profile.bio}</Text>}
                <Row gap={0} style={{ alignSelf: 'stretch', paddingVertical: 4 }}>
                  {[
                    // Moves with the Follow button at once, before the refetch.
                    { label: 'Followers', value: data.followers + (isFollowing === data.follows ? 0 : isFollowing ? 1 : -1) },
                    { label: 'Following', value: data.following },
                    { label: 'Friends', value: data.friends },
                  ].map((s) => (
                    <View key={s.label} style={{ flex: 1, alignItems: 'center' }}>
                      <Text variant="h2">{compactNumber(s.value)}</Text>
                      <Text variant="caption" muted>{s.label}</Text>
                    </View>
                  ))}
                </Row>
                {isMe ? (
                  <Row style={{ alignSelf: 'stretch' }}>
                    <Button title="Edit profile" variant="secondary" onPress={() => router.push('/profile-edit')} style={{ flex: 1 }} />
                    <Button title="Share" variant="secondary" onPress={shareProfile} style={{ flex: 1 }} />
                  </Row>
                ) : (
                  <Row style={{ alignSelf: 'stretch' }}>
                    <Button title={isFollowing ? 'Following' : 'Follow'} variant={isFollowing ? 'secondary' : 'primary'} onPress={toggleFollow} style={{ flex: 1 }} />
                    <Button title="Message" variant="secondary" onPress={() => router.push({ pathname: '/chat/[userId]', params: { userId: id } })} style={{ flex: 1 }} />
                    <Button title="•••" variant="secondary" onPress={moreActions} accessibilityLabel="More actions" style={{ paddingHorizontal: 16 }} />
                  </Row>
                )}
              </View>
            </Card>

            {data.room?.status === 'live' && (
              <PressScale onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: data.room!.id } })} accessibilityRole="button" scaleTo={0.98}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                  <LiveBadge />
                  <View style={{ flex: 1 }}>
                    <Text variant="label" numberOfLines={1}>{data.room.title || 'Live now'}</Text>
                    <Text variant="caption" faint>{compactNumber(data.room.viewer_count)} watching</Text>
                  </View>
                  <Text variant="label" color={c.primary}>Watch</Text>
                </Card>
              </PressScale>
            )}

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
            {activeTab === 'about' && (
              <View style={{ gap: 12 }}>
                {data.host && <ContributionsCard hostId={id} />}
              </View>
            )}
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}
