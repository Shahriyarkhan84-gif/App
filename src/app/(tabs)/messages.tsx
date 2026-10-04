import { useAuth } from '@clerk/clerk-expo';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Coin, Row, Screen, Text } from '@/components/ui';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { shortTime } from '@/lib/time';
import { displayName, type Profile } from '@/lib/types';

type Thread = { otherId: string; other: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null; last: string; at: string; unread: number };
type Notification = { id: number; type: string; title: string; body: string | null; data: Record<string, string>; read_at: string | null; created_at: string };

type Tab = 'chats' | 'fans' | 'gifts' | 'notifications';
type IconName = keyof typeof Ionicons.glyphMap;
// Shortcut tiles from the design canvas; tapping the open one goes back to Chats.
const TILES: { id: Exclude<Tab, 'chats'>; label: string; icon: IconName }[] = [
  { id: 'fans', label: 'New fans', icon: 'person-add-outline' },
  { id: 'gifts', label: 'Gifts', icon: 'gift-outline' },
  { id: 'notifications', label: 'System', icon: 'notifications-outline' },
];

export default function MessagesScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { c } = useTheme();
  const [tab, setTab] = useState<Tab>(params.tab === 'notifications' ? 'notifications' : 'chats');
  // Tabs stay mounted, so a later link to ?tab=notifications must switch an already-open screen.
  const [seenParam, setSeenParam] = useState(params.tab);
  if (params.tab !== seenParam) {
    setSeenParam(params.tab);
    if (params.tab === 'notifications') setTab('notifications');
  }
  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 }}>
        <Text variant="h1">Messages</Text>
        <Row gap={8}>
          {TILES.map((t) => {
            const on = tab === t.id;
            return (
              <PressScale
                key={t.id}
                scaleTo={0.95}
                haptic
                onPress={() => setTab(on ? 'chats' : t.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t.label}
                style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, backgroundColor: on ? c.primary : c.surface }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.2)' : c.surfaceRaised }}>
                  <Ionicons name={t.icon} size={20} color={on ? '#fff' : c.primary} />
                </View>
                <Text variant="caption" color={on ? '#fff' : c.text} style={{ fontWeight: '700' }}>{t.label}</Text>
              </PressScale>
            );
          })}
        </Row>
        {tab !== 'chats' && (
          <Pressable onPress={() => setTab('chats')} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Text variant="label" color={c.accent} style={{ fontSize: 13 }}>‹ Back to chats</Text>
          </Pressable>
        )}
      </View>
      {tab === 'chats' ? <Chats /> : tab === 'fans' ? <NewFans /> : tab === 'gifts' ? <GiftsReceived /> : <Notifications />}
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

  const unread = (data ?? []).filter((n) => !n.read_at).length;
  const markAllRead = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId!).is('read_at', null);
    reload();
  };

  const open = (n: Notification) => {
    // Navigate right away; mark read in the background.
    if (!n.read_at) void supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).then(() => reload());
    if (n.type.startsWith('pk_battle_')) router.push('/host/live');
    else if (n.data?.room_id) router.push({ pathname: '/live/[roomId]', params: { roomId: n.data.room_id } });
    else if (n.type === 'withdrawal') router.push('/earnings');
    else if (n.type === 'coins_credited' || n.type === 'refund') router.push('/wallet');
    else if (n.type === 'support') router.push('/support');
    else if (n.type === 'ceo_briefing' || n.type === 'ai_proposal') router.push('/admin');
  };

  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'All caught up' } })}>
      {unread > 0 && (
        <Pressable onPress={markAllRead} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-end', paddingHorizontal: 16, paddingBottom: 6 }}>
          <Text variant="label" color={c.accent} style={{ fontSize: 13 }}>Mark all read</Text>
        </Pressable>
      )}
      <FlatList
        data={data ?? []}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 6 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 50)}>
            <PressScale scaleTo={0.98} onPress={() => open(item)} accessibilityRole="button">
              <Row style={{ alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: item.read_at ? 'transparent' : c.surface }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="label" style={{ fontSize: 15 }}>{item.title}</Text>
                  {item.body && <Text variant="bodySmall" muted numberOfLines={3}>{item.body}</Text>}
                </View>
                <Text variant="caption" faint>{shortTime(item.created_at)}</Text>
              </Row>
            </PressScale>
          </FadeIn>
        )}
      />
    </StateView>
  );
}

type Fan = { follower_id: string; created_at: string; profile: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null };

/** People who followed you, newest first. */
function NewFans() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const offline = useOffline();
  const { data, error, loading, reload } = useFocusedAsync<Fan[]>(async () => {
    const { data, error } = await supabase.from('follows').select('follower_id,created_at').eq('followee_id', userId!).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const ids = (data ?? []).map((f) => f.follower_id);
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids) : { data: [] };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (data ?? []).map((f) => ({ ...f, profile: byId.get(f.follower_id) ?? null }));
  }, [userId]);
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No fans yet', body: 'Go live — people who follow you show up here.' } })}>
      <FlatList
        data={data ?? []}
        keyExtractor={(f) => f.follower_id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 40)}>
            <PressScale scaleTo={0.98} onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.follower_id } })} accessibilityRole="button">
              <Row style={{ paddingVertical: 10 }}>
                <Avatar uri={item.profile?.avatar_url} name={displayName(item.profile)} size={46} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" numberOfLines={1}>{displayName(item.profile)}</Text>
                  <Text variant="caption" faint>Started following you</Text>
                </View>
                <Text variant="caption" faint>{shortTime(item.created_at)}</Text>
              </Row>
            </PressScale>
          </FadeIn>
        )}
      />
    </StateView>
  );
}

type GiftRow = { id: number; sender_id: string; quantity: number; coins_total: number; created_at: string; sender: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null };

/** Gifts you received in your lives. */
function GiftsReceived() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const offline = useOffline();
  const { data, error, loading, reload } = useFocusedAsync<GiftRow[]>(async () => {
    const { data, error } = await supabase.from('gifts').select('id,sender_id,quantity,coins_total,created_at').eq('host_id', userId!).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const ids = [...new Set((data ?? []).map((g) => g.sender_id))];
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids) : { data: [] };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (data ?? []).map((g) => ({ ...g, sender: byId.get(g.sender_id) ?? null }));
  }, [userId]);
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No gifts yet', body: 'Gifts viewers send in your lives show up here.' } })}>
      <FlatList
        data={data ?? []}
        keyExtractor={(g) => String(g.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 40)}>
            <Row style={{ paddingVertical: 10 }}>
              <Avatar uri={item.sender?.avatar_url} name={displayName(item.sender)} size={46} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" numberOfLines={1}>{displayName(item.sender)}</Text>
                <Text variant="caption" faint>Sent {item.quantity > 1 ? `${item.quantity} gifts` : 'a gift'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Row gap={4}><Coin size={12} /><Text variant="label">{item.coins_total.toLocaleString()}</Text></Row>
                <Text variant="caption" faint>{shortTime(item.created_at)}</Text>
              </View>
            </Row>
          </FadeIn>
        )}
      />
    </StateView>
  );
}
