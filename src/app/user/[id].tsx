import { useAuth } from '@clerk/clerk-expo';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Button, Card, HostBadge, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName, type Profile } from '@/lib/types';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const [following, setFollowing] = useState<boolean | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const [profile, host, room, followers, follow] = await Promise.all([
      supabase.from('profiles').select('id,user_number,verified_at,username,display_name,avatar_url,bio,country,language,role,status,status_until').eq('id', id).single(),
      supabase.from('hosts').select('host_code,total_live_seconds').eq('user_id', id).maybeSingle(),
      supabase.from('rooms').select('id,status,title,viewer_count').eq('host_id', id).maybeSingle(),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', id),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!).eq('followee_id', id).maybeSingle(),
    ]);
    if (profile.error) throw profile.error;
    return { profile: profile.data as Profile, host: host.data, room: room.data, followers: followers.count ?? 0, follows: !!follow.data };
  }, [id, userId]);

  const isMe = id === userId;
  const isFollowing = following ?? data?.follows ?? false;

  const toggleFollow = async () => {
    const next = !isFollowing;
    setFollowing(next);
    const { error } = next
      ? await supabase.from('follows').insert({ followee_id: id })
      : await supabase.from('follows').delete().eq('follower_id', userId!).eq('followee_id', id);
    if (error) setFollowing(!next);
    else track('follow_toggled', { user_id: id, following: next });
  };

  const moreActions = () =>
    Alert.alert(displayName(data?.profile), undefined, [
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('user_blocks').insert({ blocked_id: id });
          Alert.alert(error ? 'Could not block' : 'Blocked', error ? friendlyError(error) : "They can no longer message you.");
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
    <Screen edges={[]}>
      <Stack.Screen options={{ title: data ? displayName(data.profile) : '' }} />
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Avatar uri={data.profile.avatar_url} name={displayName(data.profile)} size={96} />
              <Row gap={8}>
                <Text variant="h2">{displayName(data.profile)}</Text>
                {data.profile.verified_at && <HostBadge />}
              </Row>
              <Text muted>{[`ID ${data.profile.user_number}`, data.profile.username && `@${data.profile.username}`, data.profile.country].filter(Boolean).join(' · ')}</Text>
              <Text variant="label">{data.followers.toLocaleString()} followers</Text>
              {data.profile.bio && <Text style={{ textAlign: 'center' }}>{data.profile.bio}</Text>}
            </View>
            {data.room?.status === 'live' && (
              <Card style={{ borderColor: c.live }}>
                <Text variant="label" color={c.live}>● LIVE · {data.room.viewer_count} watching</Text>
                <Text>{data.room.title}</Text>
                <Button title="Join stream" onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: data.room!.id } })} />
              </Card>
            )}
            {!isMe && (
              <Row>
                <Button title={isFollowing ? 'Following' : 'Follow'} variant={isFollowing ? 'secondary' : 'primary'} onPress={toggleFollow} style={{ flex: 1 }} />
                <Button title="Message" variant="secondary" onPress={() => router.push({ pathname: '/chat/[userId]', params: { userId: id } })} style={{ flex: 1 }} />
                <Button title="•••" variant="ghost" onPress={moreActions} accessibilityLabel="More actions" />
              </Row>
            )}
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}
