import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Alert } from '@/lib/alert';
import { useAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName, type Profile } from '@/lib/types';

import { Avatar, Button, Card, Row, Text } from './ui';

type Member = { user_id: string; member: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null };

/**
 * A host's fan club on their profile: free for followers to join; members wear a Fan badge in
 * this host's live chat. Hidden while the server doesn't have fan clubs yet.
 */
export function FanClubCard({ hostId, isFollowing }: { hostId: string; isFollowing: boolean }) {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const isMe = userId === hostId;

  const { data, reload } = useAsync(async () => {
    const [count, mine, latest] = await Promise.all([
      supabase.from('fan_club_members').select('user_id', { count: 'exact', head: true }).eq('host_id', hostId),
      supabase.from('fan_club_members').select('user_id').eq('host_id', hostId).eq('user_id', userId!).maybeSingle(),
      supabase.from('fan_club_members').select('user_id,member:profiles!fan_club_members_user_id_fkey(display_name,username,avatar_url)')
        .eq('host_id', hostId).order('joined_at', { ascending: false }).limit(6),
    ]);
    if (count.error) return null;
    return { count: count.count ?? 0, joined: !!mine.data, latest: (latest.data ?? []) as unknown as Member[] };
  }, [hostId, userId]);

  if (!data) return null;

  const toggle = async () => {
    setBusy(true);
    const { error } = data.joined
      ? await supabase.from('fan_club_members').delete().eq('host_id', hostId).eq('user_id', userId!)
      : await supabase.from('fan_club_members').insert({ host_id: hostId, user_id: userId! });
    setBusy(false);
    if (error) Alert.alert(data.joined ? "Couldn't leave" : "Couldn't join", isFollowing ? 'Please try again.' : 'Follow this host first.');
    reload();
  };

  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <Row gap={8}>
        <Ionicons name="heart-circle" size={22} color={c.primary} />
        <Text variant="h3" style={{ flex: 1 }}>Fan club</Text>
        <Text variant="caption" muted>{data.count.toLocaleString()} {data.count === 1 ? 'member' : 'members'}</Text>
      </Row>
      {data.latest.length > 0 && (
        <Row gap={0}>
          {data.latest.map((m, i) => (
            <View key={m.user_id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 18, borderWidth: 2, borderColor: c.surface }}>
              <Avatar uri={m.member?.avatar_url} name={displayName(m.member)} size={32} />
            </View>
          ))}
        </Row>
      )}
      <Text variant="caption" muted>
        {isMe ? 'Your fans get a Fan badge in your live chat.' : 'Members get a Fan badge in this host’s live chat.'}
      </Text>
      {!isMe && (
        data.joined || isFollowing
          ? <Button title={data.joined ? 'Leave fan club' : 'Join fan club'} variant={data.joined ? 'secondary' : 'primary'} size="sm" loading={busy} onPress={() => void toggle()} />
          : <Text variant="caption" faint>Follow this host to join.</Text>
      )}
    </Card>
  );
}

/** Members of a host's fan club (for the Fan badge in live chat). Empty if fan clubs aren't set up. */
export function useFanClubMembers(hostId: string) {
  const supabase = useSupabase();
  const [members, setMembers] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let live = true;
    void Promise.resolve(supabase.from('fan_club_members').select('user_id').eq('host_id', hostId).limit(2000)).then(({ data }) => {
      if (live && data) setMembers(new Set(data.map((m) => m.user_id as string)));
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [supabase, hostId]);
  return members;
}
