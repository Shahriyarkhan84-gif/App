import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Button, Input, Row, Screen, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

type DM = { id: number; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null };

export default function ChatScreen() {
  const { userId: otherId } = useLocalSearchParams<{ userId: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c, radius } = useTheme();
  const offline = useOffline();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<DM>>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const [msgs, other] = await Promise.all([
      supabase.from('direct_messages').select('*')
        .or(`and(sender_id.eq.${userId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${userId})`)
        .order('created_at', { ascending: true }).limit(200),
      supabase.from('profiles').select('display_name,username,avatar_url').eq('id', otherId).maybeSingle(),
    ]);
    if (msgs.error) throw msgs.error;
    return { messages: msgs.data as DM[], other: other.data };
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

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
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

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: displayName(data?.other),
          headerRight: () => (
            <Row gap={16}>
              <Pressable onPress={() => Alert.alert('Voice calls', 'Coming soon.')} accessibilityRole="button" accessibilityLabel="Voice call">
                <Ionicons name="call-outline" size={21} color={c.text} />
              </Pressable>
              <Pressable onPress={() => Alert.alert('Video calls', 'Coming soon.')} accessibilityRole="button" accessibilityLabel="Video call">
                <Ionicons name="videocam-outline" size={22} color={c.text} />
              </Pressable>
            </Row>
          ),
        }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
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
                      backgroundColor: mine ? c.primary : c.surfaceRaised,
                      borderRadius: radius[16],
                      borderBottomRightRadius: mine ? 4 : radius[16],
                      borderBottomLeftRadius: mine ? radius[16] : 4,
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
        <Row style={{ padding: 12 }}>
          <View style={{ flex: 1 }}>
            <Input value={draft} onChangeText={setDraft} placeholder="Message" maxLength={1000} onSubmitEditing={send} />
          </View>
          <Button title="Send" onPress={send} loading={sending} disabled={!draft.trim() || offline} />
        </Row>
      </KeyboardAvoidingView>
    </Screen>
  );
}
