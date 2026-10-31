import { useAuth } from '@clerk/clerk-expo';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { FansList } from '@/components/FansList';
import { useTabBarSpace } from '@/components/Menus';
import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Button, Coin, glassShadow, Row, Screen, Sheet, Text } from '@/components/ui';
import { confirmAction } from '@/lib/alert';
import { hasFeature, U } from '@/lib/brand';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { shortTime } from '@/lib/time';
import { displayName, type Profile } from '@/lib/types';

type Thread = { otherId: string; other: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null; last: string; at: string; unread: number; iSent: boolean; followed: boolean; pinned: boolean; muted: boolean };
type ThreadPrefs = { other_id: string; pinned: boolean; muted: boolean; cleared_at: string | null };
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
  const tabSpace = useTabBarSpace();
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
        <Text variant="display">Messages</Text>
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
                style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 20, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.glassBorder, ...glassShadow }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.2)' : c.surfaceRaised }}>
                  <Ionicons name={t.icon} size={20} color={on ? c.primaryText : c.primary} />
                </View>
                <Text variant="caption" color={on ? c.primaryText : c.text} style={{ fontWeight: '700' }}>{t.label}</Text>
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
      {tab === 'chats' ? <Chats /> : tab === 'fans' ? <FansList bottomInset={tabSpace + 16} /> : tab === 'gifts' ? <GiftsReceived /> : <Notifications />}
    </Screen>
  );
}

function Chats() {
  const tabSpace = useTabBarSpace();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const { profile } = useProfile();
  const [showRequests, setShowRequests] = useState(false);
  // Long-press options (pin, mute, delete); only offered once the server has the table.
  const [options, setOptions] = useState<Thread | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);

  const { data, error, loading, reload } = useFocusedAsync<Thread[]>(async () => {
    const [msgs, follows, prefRows] = await Promise.all([
      supabase
        .from('direct_messages')
        .select('sender_id,recipient_id,body,created_at,read_at')
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!),
      supabase.from('dm_thread_prefs').select('other_id,pinned,muted,cleared_at').eq('user_id', userId!),
    ]);
    if (msgs.error) throw msgs.error;
    setPrefsReady(!prefRows.error);
    const prefs = new Map(((prefRows.error ? [] : prefRows.data) as ThreadPrefs[]).map((p) => [p.other_id, p]));
    const followed = new Set((follows.data ?? []).map((f) => f.followee_id));
    const threads = new Map<string, Thread>();
    for (const m of msgs.data ?? []) {
      const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
      const pref = prefs.get(otherId);
      // "Delete chat" hides everything up to that moment, for you only.
      if (pref?.cleared_at && m.created_at <= pref.cleared_at) continue;
      const t = threads.get(otherId) ?? { otherId, other: null, last: m.body, at: m.created_at, unread: 0, iSent: false, followed: followed.has(otherId), pinned: !!pref?.pinned, muted: !!pref?.muted };
      if (m.recipient_id === userId && !m.read_at) t.unread += 1;
      if (m.sender_id === userId) t.iSent = true;
      threads.set(otherId, t);
    }
    const ids = [...threads.keys()];
    if (ids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids);
      for (const p of profiles ?? []) threads.get(p.id)!.other = p;
    }
    // Pinned chats stay on top; otherwise newest first (the order messages arrived in).
    return [...threads.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [userId], 'msg-threads');

  const setPref = async (t: Thread, change: Partial<Omit<ThreadPrefs, 'other_id'>>) => {
    setOptions(null);
    await supabase.from('dm_thread_prefs').upsert({ user_id: userId!, other_id: t.otherId, ...change }, { onConflict: 'user_id,other_id' });
    reload();
  };
  const deleteChat = (t: Thread) => {
    setOptions(null);
    confirmAction('Delete this chat?', `Messages with ${displayName(t.other)} are removed from your list. They still have their copy.`, 'Delete', () => {
      void (async () => {
        await supabase.from('direct_messages').update({ read_at: new Date().toISOString() }).eq('recipient_id', userId!).eq('sender_id', t.otherId).is('read_at', null);
        await setPref(t, { cleared_at: new Date().toISOString() });
      })();
    });
  };

  useRealtime('direct_messages', `recipient_id=eq.${userId}`, () => reload());

  // Settings → Privacy → Message requests: chats started by people you don't follow (and haven't
  // answered) wait in their own folder instead of the main list.
  const collapse = profile?.message_requests === true;
  const isRequest = (t: Thread) => collapse && !t.followed && !t.iSent;
  const requests = (data ?? []).filter(isRequest);
  const viewing = showRequests && requests.length > 0;
  const list = viewing ? requests : (data ?? []).filter((t) => !isRequest(t));
  const requestUnread = requests.reduce((n, t) => n + t.unread, 0);

  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No conversations yet', body: 'Message someone from their profile.' } })}>
      <FlatList
        data={list}
        ListHeaderComponent={requests.length > 0 ? (
          <PressScale scaleTo={0.98} onPress={() => setShowRequests((v) => !v)} accessibilityRole="button" accessibilityLabel={viewing ? 'Back to chats' : `Message requests, ${requests.length}`}>
            <Row style={{ padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.violetSurface, borderWidth: 1, borderColor: c.violetBorder }}>
              <Ionicons name={viewing ? 'arrow-back' : 'mail-unread-outline'} size={20} color={c.primary} />
              <Text variant="label" style={{ flex: 1 }}>{viewing ? 'Back to chats' : `Message requests (${requests.length})`}</Text>
              {!viewing && requestUnread > 0 && <Text variant="caption" color={c.primary}>{requestUnread} new</Text>}
              {!viewing && <Ionicons name="chevron-forward" size={18} color={c.textFaint} />}
            </Row>
          </PressScale>
        ) : null}
        keyExtractor={(t) => t.otherId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabSpace + 16, gap: 8 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 50)}>
          <PressScale scaleTo={0.98} onPress={() => router.push({ pathname: '/chat/[userId]', params: { userId: item.otherId } })}
            onLongPress={prefsReady ? () => setOptions(item) : undefined} accessibilityRole="button"
            accessibilityHint={prefsReady ? 'Long press for options' : undefined}>
            <Row style={{ padding: 12, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
              <Avatar uri={item.other?.avatar_url} name={displayName(item.other)} size={52} ring={item.unread > 0 ? c.primary : undefined} />
              <View style={{ flex: 1, gap: 3 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row gap={4} style={{ flex: 1 }}>
                    <Text variant="label" style={{ fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{displayName(item.other)}</Text>
                    {item.pinned && <Ionicons name="pin" size={13} color={c.textFaint} accessibilityLabel="Pinned" />}
                    {item.muted && <Ionicons name="notifications-off" size={13} color={c.textFaint} accessibilityLabel="Muted" />}
                  </Row>
                  <Text variant="caption" faint>{shortTime(item.at)}</Text>
                </Row>
                <Text variant="bodySmall" muted={item.unread === 0} numberOfLines={1} style={{ fontSize: 14 }}>{item.last}</Text>
              </View>
              {item.unread > 0 && (
                <View style={{ backgroundColor: item.muted ? c.textFaint : c.primary, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="caption" color={c.primaryText} style={{ fontSize: 11, fontWeight: '700' }}>{item.unread}</Text>
                </View>
              )}
            </Row>
          </PressScale>
          </FadeIn>
        )}
      />
      <Sheet visible={!!options} onClose={() => setOptions(null)} title={options ? displayName(options.other) : undefined}>
        {options && (
          <View style={{ gap: 8 }}>
            <Button title={options.pinned ? 'Unpin chat' : 'Pin to top'} variant="secondary" onPress={() => void setPref(options, { pinned: !options.pinned })} />
            <Button title={options.muted ? 'Unmute' : 'Mute'} variant="secondary" onPress={() => void setPref(options, { muted: !options.muted })} />
            <Button title="Delete chat" variant="ghost" onPress={() => deleteChat(options)} />
          </View>
        )}
      </Sheet>
    </StateView>
  );
}

function Notifications() {
  const tabSpace = useTabBarSpace();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId!).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data as Notification[];
  }, [userId], 'msg-notifications');
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
    else if (n.type === 'media_removed' && hasFeature('videos')) router.push('/videos/upload');
    else if (n.type === 'media_ready' && n.data?.asset_id && hasFeature('videos')) router.push({ pathname: '/videos/[id]', params: { id: n.data.asset_id } });
    else if (n.type === 'media_failed' && hasFeature('videos')) router.push('/videos/upload');
    else if (n.data?.event_id && hasFeature('events')) router.push({ pathname: '/events/[id]', params: { id: String(n.data.event_id) } });
    else if (n.type === 'verification') router.push('/hosting');
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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabSpace + 16, gap: 6 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 50)}>
            <PressScale scaleTo={0.98} onPress={() => open(item)} accessibilityRole="button">
              <Row style={{ alignItems: 'flex-start', padding: 14, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.violetSurface, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={notificationIcon(item.type)} size={19} color={c.primary} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="label" style={{ fontSize: 15 }}>{unitWords(item.title)}</Text>
                  {item.body && <Text variant="bodySmall" muted numberOfLines={3}>{unitWords(item.body)}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text variant="caption" faint>{shortTime(item.created_at)}</Text>
                  {!item.read_at && <View accessibilityLabel="Unread" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary }} />}
                </View>
              </Row>
            </PressScale>
          </FadeIn>
        )}
      />
    </StateView>
  );
}

/** Server notifications say "coins"/"diamonds" (the database's unit names); show the brand's names. */
function unitWords(text: string) {
  return text
    .replace(/\bdiamonds\b/g, U.earn).replace(/\bDiamonds\b/g, U.Earn).replace(/\bdiamond\b/g, U.earnOne)
    .replace(/\bcoins\b/g, U.spend).replace(/\bCoins\b/g, U.Spend).replace(/\bcoin\b/g, U.spendOne);
}

/** Icon for a notification type (gifts, follows, lives, money, support…). */
function notificationIcon(type: string): IconName {
  if (/gift/.test(type)) return 'gift-outline';
  if (/follow/.test(type)) return 'person-add-outline';
  if (/live/.test(type)) return 'radio-outline';
  if (/withdraw|payout|coins|refund|payment/.test(type)) return 'wallet-outline';
  if (/media|video/.test(type)) return 'play-circle-outline';
  if (/verif/.test(type)) return 'shield-checkmark-outline';
  if (/support/.test(type)) return 'help-buoy-outline';
  return 'notifications-outline';
}

type GiftRow = { id: number; sender_id: string; quantity: number; coins_total: number; created_at: string; sender: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null };

/** Gifts you received in your lives. */
function GiftsReceived() {
  const { c } = useTheme();
  const tabSpace = useTabBarSpace();
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
  }, [userId], 'msg-gifts');
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No gifts yet', body: 'Gifts viewers send in your lives show up here.' } })}>
      <FlatList
        data={data ?? []}
        keyExtractor={(g) => String(g.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabSpace + 16, gap: 8 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 40)}>
            <Row style={{ padding: 12, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
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
