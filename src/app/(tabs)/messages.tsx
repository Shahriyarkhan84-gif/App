import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Row, Screen, Segmented, Text } from '@/components/ui';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName, type Profile } from '@/lib/types';

type Thread = { otherId: string; other: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null; last: string; at: string; unread: number };
type Notification = { id: number; type: string; title: string; body: string | null; data: Record<string, string>; read_at: string | null; created_at: string };

const TABS = [
  { id: 'chats', label: 'Chats' },
  { id: 'notifications', label: 'Notifications' },
] as const;

export default function MessagesScreen() {
  const [tab, setTab] = useState<'chats' | 'notifications'>('chats');
  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 }}>
        <Text variant="h1">Messages</Text>
        <Segmented options={TABS} value={tab} onChange={setTab} />
      </View>
      {tab === 'chats' ? <Chats /> : <Notifications />}
    </Screen>
  );
}

function Chats() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();

  const { data, error, loading, reload } = useFocusedAsync<Thread[]>(async () => {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('sender_id,recipient_id,body,created_at,read_at')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    const threads = new Map<string, Thread>();
    for (const m of data ?? []) {
      const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
      const t = threads.get(otherId) ?? { otherId, other: null, last: m.body, at: m.created_at, unread: 0 };
      if (m.recipient_id === userId && !m.read_at) t.unread += 1;
      threads.set(otherId, t);
    }
    const ids = [...threads.keys()];
    if (ids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids);
      for (const p of profiles ?? []) threads.get(p.id)!.other = p;
    }
    return [...threads.values()];
  }, [userId]);

  useRealtime('direct_messages', `recipient_id=eq.${userId}`, () => reload());

  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No conversations yet', body: 'Message someone from their profile.' } })}>
      <FlatList
        data={data ?? []}
        keyExtractor={(t) => t.otherId}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 50)}>
          <PressScale scaleTo={0.98} onPress={() => router.push({ pathname: '/chat/[userId]', params: { userId: item.otherId } })} accessibilityRole="button">
            <Row style={{ paddingVertical: 10 }}>
              <Avatar uri={item.other?.avatar_url} name={displayName(item.other)} size={52} ring={item.unread > 0 ? c.primary : undefined} />
              <View style={{ flex: 1, gap: 3 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="label" style={{ fontSize: 15 }} numberOfLines={1}>{displayName(item.other)}</Text>
                  <Text variant="caption" faint>{shortTime(item.at)}</Text>
                </Row>
                <Text variant="bodySmall" muted={item.unread === 0} numberOfLines={1} style={{ fontSize: 14 }}>{item.last}</Text>
              </View>
              {item.unread > 0 && (
                <View style={{ backgroundColor: c.primary, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="caption" color={c.primaryText} style={{ fontSize: 11, fontWeight: '700' }}>{item.unread}</Text>
                </View>
              )}
            </Row>
          </PressScale>
          </FadeIn>
        )}
      />
    </StateView>
  );
}

function Notifications() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId!).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data as Notification[];
  }, [userId]);
  useRealtime('notifications', `user_id=eq.${userId}`, () => reload());

  const open = async (n: Notification) => {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      reload();
    }
    if (n.type.startsWith('pk_battle_')) router.push('/host/live');
    else if (n.data?.room_id) router.push({ pathname: '/live/[roomId]', params: { roomId: n.data.room_id } });
    else if (n.type === 'withdrawal') router.push('/earnings');
    else if (n.type === 'coins_credited' || n.type === 'refund') router.push('/wallet');
    else if (n.type === 'support') router.push('/support');
    else if (n.type === 'ceo_briefing' || n.type === 'ai_proposal') router.push('/admin');
  };

  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'All caught up' } })}>
      <FlatList
        data={data ?? []}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 4 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item)}>
            <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider, opacity: item.read_at ? 0.6 : 1 }}>
              <Text variant="label">{item.title}</Text>
              {item.body && <Text muted numberOfLines={3}>{item.body}</Text>}
              <Text variant="caption" muted>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
          </Pressable>
        )}
      />
    </StateView>
  );
}

function shortTime(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return d.toLocaleDateString();
}
