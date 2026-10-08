import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ContributionsCard } from '@/components/Contributions';
import { LiveAvatar } from '@/components/FollowingLive';
import { PressScale } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { FramedAvatar } from '@/components/FramedAvatar';
import { Button, compactNumber, RoleBadges, Row, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { countryName, flag } from '@/lib/country';
import { friendlyError } from '@/lib/errors';
import { useAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
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

  const { data, error, loading, reload } = useAsync(async () => {
    const [profile, host, room, followers, follow, followingList, pin] = await Promise.all([
      supabase.from('profiles').select('id,user_number,verified_at,owner_verified_at,username,display_name,avatar_url,bio,country,signup_country,language,role,status,status_until,deleted_at,active_frame_id').eq('id', id).maybeSingle(),
      supabase.from('hosts').select('host_code,total_live_seconds').eq('user_id', id).maybeSingle(),
      supabase.from('rooms').select('id,status,title,viewer_count').eq('host_id', id).maybeSingle(),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', id),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!).eq('followee_id', id).maybeSingle(),
      supabase.from('follows').select('followee_id', { count: 'exact' }).eq('follower_id', id).limit(1000),
      supabase.from('pinned_profiles').select('user_id').eq('user_id', id).maybeSingle(),
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
      following: followingList.count ?? 0, friends, pinned: !!pin.data,
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
    void shareMessage(`${displayName(data.profile)} on Zynalive — ID ${data.profile.user_number}: zynalive://user/${id}`);
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

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: data ? displayName(data.profile) : '',
          headerRight: data ? () => (
            <PressScale onPress={shareProfile} accessibilityRole="button" accessibilityLabel="Share this profile" hitSlop={12}>
              <Ionicons name="share-social-outline" size={21} color={c.text} />
            </PressScale>
          ) : undefined,
        }}
      />
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d === null, empty: { title: "This account doesn't exist", body: "It may have been deleted." } })}>
        {data && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              {data.room?.status === 'live' ? (
                <PressScale
                  scaleTo={0.94}
                  onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: data.room!.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${displayName(data.profile)} is live, ${data.room.viewer_count} watching. Watch`}
                  style={{ marginBottom: 8 }}
                >
                  <LiveAvatar uri={data.profile.avatar_url} name={displayName(data.profile)} size={108} />
                </PressScale>
              ) : (
                <FramedAvatar uri={data.profile.avatar_url} name={displayName(data.profile)} size={96} frameId={data.profile.active_frame_id} />
              )}
              <Row gap={8}>
                <Text variant="h2">{displayName(data.profile)}</Text>
                <RoleBadges profile={data.profile} />
              </Row>
              <Text muted selectable>ID {data.profile.user_number}</Text>
              {data.profile.signup_country && (
                <View accessibilityLabel={`Joined from ${countryName(data.profile.signup_country)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
                  <Ionicons name="location" size={13} color={c.primary} />
                  <Text variant="caption">{flag(data.profile.signup_country)} {countryName(data.profile.signup_country)}</Text>
                </View>
              )}
              <Row gap={20} style={{ paddingVertical: 4 }}>
                {[
                  { label: 'Friends', value: data.friends },
                  // Moves with the Follow button at once, before the refetch.
                  { label: 'Followers', value: data.followers + (isFollowing === data.follows ? 0 : isFollowing ? 1 : -1) },
                  { label: 'Following', value: data.following },
                ].map((s) => (
                  <View key={s.label} style={{ alignItems: 'center' }}>
                    <Text variant="h3">{compactNumber(s.value)}</Text>
                    <Text variant="caption" muted>{s.label}</Text>
                  </View>
                ))}
              </Row>
              {data.profile.bio && <Text style={{ textAlign: 'center' }}>{data.profile.bio}</Text>}
            </View>
            {isPlatformAdmin && (
              <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
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
            {data.host && <ContributionsCard hostId={id} />}
          </ScrollView>
        )}
        {data && !isMe && (
          // Pinned footer: Follow / Message stay in place while the profile scrolls.
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background }}>
            <Row style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
              <Button title={isFollowing ? 'Following' : 'Follow'} variant={isFollowing ? 'secondary' : 'primary'} onPress={toggleFollow} style={{ flex: 1, minHeight: 54 }} />
              <Button title="Message" variant="secondary" onPress={() => router.push({ pathname: '/chat/[userId]', params: { userId: id } })} style={{ flex: 1, minHeight: 54 }} />
              <Button title="•••" variant="ghost" onPress={moreActions} accessibilityLabel="More actions" />
            </Row>
          </View>
        )}
      </StateView>
    </Screen>
  );
}
