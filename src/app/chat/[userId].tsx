import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Button, Input, Row, Screen, Text } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

type DM = { id: number; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null };

export default function ChatScreen() {
  const { userId: otherId } = useLocalSearchParams<{ userId: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const offline = useOffline();
  const { profile } = useProfile();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<DM>>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const [msgs, other, block, pref] = await Promise.all([
      supabase.from('direct_messages').select('*')
        .or(`and(sender_id.eq.${userId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${userId})`)
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('profiles').select('display_name,username,avatar_url').eq('id', otherId).maybeSingle(),
      // Only your own blocks are readable; being blocked by them is still found out on send.
      supabase.from('user_blocks').select('blocked_id').eq('blocker_id', userId!).eq('blocked_id', otherId).maybeSingle(),
      // "Delete chat" in Messages hides older messages for you (ignored if it can't be read).
      supabase.from('dm_thread_prefs').select('cleared_at').eq('user_id', userId!).eq('other_id', otherId).maybeSingle(),
    ]);
    if (msgs.error) throw msgs.error;
    const clearedAt = (pref.data as { cleared_at?: string | null } | null)?.cleared_at ?? null;
    // Newest 200, shown oldest first.
    const messages = (msgs.data as DM[]).filter((m) => !clearedAt || m.created_at > clearedAt).reverse();
    return { messages, other: other.data, iBlocked: !!block.data };
  }, [userId, otherId]);

  useRealtime('direct_messages', `recipient_id=eq.${userId}`, (p) => {
    if ((p.new as DM).sender_id === otherId) reload();
  });

  // Mark incoming messages as read.
  useEffect(() => {
    if (!data?.messages.some((m) => m.recipient_id === userId && !m.read_at)) return;
    void supabase.from('direct_messages').update({ read_at: new Date().toISOString() })
      .eq('recipient_id', userId!).eq('sender_id', otherId).is('read_at', null);
  }, [data, supabase, userId, otherId]);

  // Restricted or banned accounts, and people you blocked, can't be messaged: say so up front.
  const cantSend = profile && (profile.status !== 'active' || profile.age_check === 'minor') ? 'Your account can’t send messages right now.'
    : data?.iBlocked ? 'You blocked this person. Unblock them to send a message.' : null;

  const send = async () => {
    const body = draft.trim();
    // The keyboard's return key bypasses the disabled Send button.
    if (!body || sending || offline || cantSend) return;
    setSending(true);
    try {
      await rpc(supabase, 'send_direct_message', { p_recipient: otherId, p_body: body });
      setDraft('');
      reload();
    } catch (e) {
      Alert.alert('Not sent', friendlyError(e));
    } finally {
      setSending(false);
    }
  };

  const moreActions = () =>
    Alert.alert(displayName(data?.other), undefined, [
      {
        text: 'Report',
        onPress: async () => {
          try {
            await rpc(supabase, 'report_content', { p_target_type: 'user', p_target_id: otherId, p_reason: 'Reported from direct messages' });
            Alert.alert('Reported', 'Thanks — our moderators will review it.');
          } catch (e) {
            Alert.alert('Report failed', friendlyError(e));
          }
        },
      },
      data?.iBlocked ? {
        text: 'Unblock',
        onPress: async () => {
          const { error: unblockErr } = await supabase.from('user_blocks').delete().eq('blocker_id', userId!).eq('blocked_id', otherId);
          if (unblockErr) Alert.alert('Could not unblock', friendlyError(unblockErr));
          else reload();
        },
      } : {
        text: 'Block',
        style: 'destructive' as const,
        onPress: () => confirmAction('Block this person?', "You'll stop following each other and they can't message you.", 'Block', async () => {
          try {
            await rpc(supabase, 'block_user', { p_user: otherId });
            router.back();
          } catch (e) {
            Alert.alert('Could not block', friendlyError(e));
          }
        }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: displayName(data?.other),
          headerRight: () => (
            // Block / report from the conversation itself (calls aren't built yet, so no call buttons).
            <Pressable onPress={moreActions} accessibilityRole="button" accessibilityLabel="More options" hitSlop={10}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={c.text} />
            </Pressable>
          ),
        }}
      />
      {/* Android draws edge to edge, so the window no longer shrinks for the keyboard: pad on both platforms. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : insets.top + 56}>
        <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.messages.length === 0, empty: { title: 'Say hi 👋' } })}>
          <FlatList
            ref={listRef}
            data={data?.messages ?? []}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={{ padding: 16, gap: 6 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => {
              const mine = item.sender_id === userId;
              const prev = data?.messages[index - 1];
              const showAvatar = !mine && prev?.sender_id !== item.sender_id;
              return (
                <Row gap={8} style={{ justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: showAvatar || mine ? 10 : 2 }}>
                  {!mine && (showAvatar ? <Avatar uri={data?.other?.avatar_url} name={displayName(data?.other)} size={26} /> : <View style={{ width: 26 }} />)}
                  <View
                    style={{
                      maxWidth: '75%',
                      backgroundColor: mine ? c.primary : c.surface,
                      borderWidth: mine ? 0 : 1,
                      borderColor: c.glassBorder,
                      borderRadius: radius[20],
                      borderBottomRightRadius: mine ? 6 : radius[20],
                      borderBottomLeftRadius: mine ? radius[20] : 6,
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                    }}
                  >
                    <Text color={mine ? c.primaryText : c.text}>{item.body}</Text>
                  </View>
                </Row>
              );
            }}
          />
        </StateView>
        {cantSend && <Text variant="bodySmall" muted style={{ paddingHorizontal: 16, paddingTop: 8 }}>{cantSend}</Text>}
        <Row style={{ padding: 12 }}>
          <View style={{ flex: 1 }}>
            <Input editable={!cantSend} value={draft} onChangeText={setDraft} placeholder="Message…" maxLength={1000} onSubmitEditing={send} />
          </View>
          <Button title="Send" onPress={send} loading={sending} disabled={!draft.trim() || offline || !!cantSend} />
        </Row>
      </KeyboardAvoidingView>
    </Screen>
  );
}
