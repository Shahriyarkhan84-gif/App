import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Alert, confirmAction } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { enforceInRoom, rpc } from '@/lib/api';
import { flag } from '@/lib/country';
import { friendlyError } from '@/lib/errors';
import { useAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

import { FramedAvatar } from './FramedAvatar';
import { compactNumber, RoleBadges, Row, Sheet, Text } from './ui';

type CardProfile = {
  id: string; user_number: number | null; username: string | null; display_name: string | null; avatar_url: string | null;
  country: string | null; role: string | null; verified_at: string | null; owner_verified_at: string | null; active_frame_id: string | null;
};

/**
 * Mini profile shown when you tap someone in a live room (chat name, host, top gifter):
 * photo, name, ID, country, followers/following, Follow / Message / Profile, and for the host or a
 * room admin the room tools (mute, remove, block, make admin). Every action goes through the same
 * RPCs as the rest of the app, which check permissions on the server.
 */
export function ProfileCard({ userId, roomId, hostId, canModerate, isHost, onClose }: {
  userId: string | null; roomId: string; hostId: string; canModerate: boolean; isHost: boolean; onClose: () => void;
}) {
  const supabase = useSupabase();
  const { c } = useTheme();
  const { userId: me } = useAuth();
  const track = useAnalytics();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useAsync(async () => {
    if (!userId) return null;
    const [p, followers, followingCount, follow] = await Promise.all([
      supabase.from('profiles').select('id,user_number,username,display_name,avatar_url,country,role,verified_at,owner_verified_at,active_frame_id').eq('id', userId).maybeSingle(),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', userId),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
      supabase.from('follows').select('followee_id').eq('follower_id', me!).eq('followee_id', userId).maybeSingle(),
    ]);
    if (p.error) throw p.error;
    return { profile: p.data as CardProfile | null, followers: followers.count ?? 0, following: followingCount.count ?? 0, follows: !!follow.data };
  }, [userId, me]);

  const close = () => {
    setFollowing(null);
    onClose();
  };
  const p = data.data?.profile;
  const name = p ? (p.display_name || p.username || 'Someone') : '';
  const isMe = userId === me;
  const isFollowing = following ?? data.data?.follows ?? false;
  // Room tools: never on yourself or the host; the server checks the caller is the host or an admin.
  const showTools = !!userId && canModerate && !isMe && userId !== hostId;

  const toggleFollow = async () => {
    if (!userId || busy) return;
    setBusy(true);
    const next = !isFollowing;
    setFollowing(next);
    const { error } = next
      ? await supabase.from('follows').insert({ followee_id: userId })
      : await supabase.from('follows').delete().eq('follower_id', me!).eq('followee_id', userId);
    setBusy(false);
    if (error) {
      setFollowing(!next);
      Alert.alert(next ? "Couldn't follow" : "Couldn't unfollow", friendlyError(error));
    } else track('follow_toggled', { user_id: userId, following: next });
  };

  const moderate = async (action: 'mute' | 'kick' | 'block', minutes?: number) => {
    if (!userId) return;
    try {
      await rpc(supabase, 'room_moderate', { p_room: roomId, p_target: userId, p_action: action, p_minutes: minutes ?? null });
      void enforceInRoom(supabase, roomId, userId);
      close();
      Alert.alert('Done', `${name} was ${action === 'mute' ? 'muted for 10 minutes' : action === 'kick' ? 'removed for 1 hour' : 'blocked from your room'}.`);
    } catch (e) {
      Alert.alert('Action failed', friendlyError(e));
    }
  };
  const makeAdmin = async () => {
    if (!userId) return;
    try {
      await rpc(supabase, 'set_room_admin', { p_user: userId, p_enabled: true });
      close();
      Alert.alert('Room admin added', `${name} can now help moderate while you're live.`);
    } catch (e) {
      Alert.alert('Could not add admin', friendlyError(e));
    }
  };
  const report = async () => {
    if (!userId) return;
    try {
      await rpc(supabase, 'report_content', { p_target_type: 'user', p_target_id: userId, p_reason: 'Reported from a live room' });
      track('report_submitted', { target_type: 'user' });
      close();
      Alert.alert('Thanks', 'Our moderators will review this account.');
    } catch (e) {
      Alert.alert('Report failed', friendlyError(e));
    }
  };
  const go = (pathname: '/user/[id]' | '/chat/[userId]') => {
    close();
    if (!userId) return;
    router.push(pathname === '/user/[id]' ? { pathname, params: { id: userId } } : { pathname, params: { userId } });
  };

  return (
    <Sheet visible={!!userId} onClose={close}>
      {data.loading && !p ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={c.primary} /></View>
      ) : data.error ? (
        <View style={{ paddingVertical: 24, alignItems: 'center', gap: 10 }}>
          <Text muted>{friendlyError(data.error)}</Text>
          <Pressable onPress={data.reload} accessibilityRole="button"><Text variant="label" color={c.primary}>Try again</Text></Pressable>
        </View>
      ) : !p ? (
        <Text muted style={{ textAlign: 'center', paddingVertical: 24 }}>This account is no longer available.</Text>
      ) : (
        <View style={{ alignItems: 'center', gap: 10 }}>
          <FramedAvatar uri={p.avatar_url} name={name} size={84} frameId={p.active_frame_id} ring={userId === hostId ? c.gold : c.primary} />
          <Row gap={6}>
            <Text variant="h2" numberOfLines={1} style={{ maxWidth: 240 }}>{name}</Text>
            <RoleBadges profile={p} small />
          </Row>
          <Text variant="caption" faint>
            {p.user_number ? `ID ${p.user_number}` : ''}{p.country ? ` · ${flag(p.country)} ${p.country}` : ''}{userId === hostId ? ' · Host' : ''}
          </Text>
          <Row gap={0} style={{ alignSelf: 'stretch' }}>
            {[[compactNumber(data.data?.followers ?? 0), 'Followers'], [compactNumber(data.data?.following ?? 0), 'Following']].map(([v, l]) => (
              <View key={l} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Text variant="h3">{v}</Text>
                <Text variant="caption" faint>{l}</Text>
              </View>
            ))}
          </Row>
          {!isMe && (
            <Row gap={10} style={{ alignSelf: 'stretch' }}>
              <CardButton title={isFollowing ? 'Following' : 'Follow'} primary={!isFollowing} onPress={toggleFollow} disabled={busy} />
              <CardButton title="Message" onPress={() => go('/chat/[userId]')} />
              <CardButton title="Profile" onPress={() => go('/user/[id]')} />
            </Row>
          )}
          {isMe && <CardButton title="View my profile" onPress={() => go('/user/[id]')} />}
          {showTools && (
            <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 4 }}>
              <Text variant="label" faint style={{ fontSize: 13 }}>Host tools</Text>
              <Row gap={8}>
                <ToolButton title="Mute 10m" onPress={() => moderate('mute', 10)} />
                <ToolButton title="Remove" onPress={() => confirmAction('Remove from room?', `${name} is removed for 1 hour.`, 'Remove', () => moderate('kick', 60))} />
                <ToolButton title="Block" danger onPress={() => confirmAction('Block from room?', `${name} can't come back to your room.`, 'Block', () => moderate('block'))} />
                {isHost && <ToolButton title="Admin" onPress={makeAdmin} />}
              </Row>
            </View>
          )}
          {!isMe && (
            <Pressable onPress={() => confirmAction('Report this account?', 'Our moderators will review it.', 'Report', report)} accessibilityRole="button" hitSlop={8} style={{ paddingVertical: 6 }}>
              <Text variant="label" faint>Report</Text>
            </Pressable>
          )}
        </View>
      )}
    </Sheet>
  );
}

function CardButton({ title, onPress, primary, disabled }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title}
      style={{ flex: 1, minHeight: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: primary ? c.primary : c.surface, opacity: disabled ? 0.6 : 1 }}>
      <Text variant="label" color={primary ? c.primaryText : c.text}>{title}</Text>
    </Pressable>
  );
}

function ToolButton({ title, onPress, danger }: { title: string; onPress: () => void; danger?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? '#FFE4E6' : c.surface }}>
      <Text variant="label" color={danger ? c.live : c.text} style={{ fontSize: 12 }}>{title}</Text>
    </Pressable>
  );
}
