import { getLocales } from 'expo-localization';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { fonts, liveColors as c } from '@/lib/theme';
import { displayName, type ChatMessage } from '@/lib/types';

import { Button, Sheet, Text } from './ui';

const SELECT = 'id,room_id,sender_id,body,status,created_at,sender:profiles!messages_sender_id_fkey(display_name,username,avatar_url)';

type Props = {
  roomId: string;
  hostId: string;
  canModerate: boolean;
  isHost: boolean;
  onUserPress?: (userId: string) => void;
};

export function ChatPanel({ roomId, hostId, canModerate, isHost, onUserPress, actions }: Props & { actions?: ReactNode }) {
  const supabase = useSupabase();
  const track = useAnalytics();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<ChatMessage | null>(null);
  const senderCache = useRef(new Map<string, ChatMessage['sender']>());
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('messages').select(SELECT).eq('room_id', roomId).eq('status', 'visible')
      .order('created_at', { ascending: false }).limit(60);
    const rows = ((data ?? []) as unknown as ChatMessage[]).reverse();
    rows.forEach((m) => senderCache.current.set(m.sender_id, m.sender));
    setMessages(rows);
  }, [supabase, roomId]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    // Reconcile periodically so messages hidden by AI moderation disappear
    // (hidden rows are filtered by RLS, so no realtime event reaches viewers).
    const interval = setInterval(() => void refresh(), 15000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [refresh]);

  useRealtime('messages', `room_id=eq.${roomId}`, async (payload) => {
    if (payload.eventType !== 'INSERT') return;
    const m = payload.new as unknown as ChatMessage;
    if (m.status !== 'visible') return;
    if (!senderCache.current.has(m.sender_id)) {
      const { data } = await supabase.from('profiles').select('display_name,username,avatar_url').eq('id', m.sender_id).maybeSingle();
      senderCache.current.set(m.sender_id, data);
    }
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev.slice(-99), { ...m, sender: senderCache.current.get(m.sender_id) }]));
  });

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await rpc(supabase, 'send_chat_message', { p_room: roomId, p_body: body });
      setDraft('');
      track('chat_sent', { room_id: roomId });
    } catch (e) {
      Alert.alert('Message not sent', friendlyError(e));
    } finally {
      setSending(false);
    }
  };

  const translate = async (m: ChatMessage) => {
    setSelected(null);
    const language = getLocales()[0]?.languageCode ?? 'en';
    try {
      await rpc(supabase, 'request_translation', { p_message_id: m.id, p_language: language });
      // The Translation agent runs in the background; poll briefly for the result.
      for (let i = 0; i < 10; i++) {
        const { data } = await supabase.from('message_translations').select('body').eq('message_id', m.id).eq('language', language).maybeSingle();
        if (data) {
          setTranslations((t) => ({ ...t, [m.id]: data.body }));
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      Alert.alert('Translation', 'Translation is taking longer than usual. Try again shortly.');
    } catch (e) {
      Alert.alert('Translation failed', friendlyError(e));
    }
  };

  const moderate = async (m: ChatMessage, action: 'mute' | 'kick' | 'block', minutes?: number) => {
    setSelected(null);
    try {
      await rpc(supabase, 'room_moderate', { p_room: roomId, p_target: m.sender_id, p_action: action, p_minutes: minutes ?? null });
      Alert.alert('Done', `${displayName(m.sender)} was ${action === 'mute' ? 'muted' : action === 'kick' ? 'removed' : 'blocked'}.`);
    } catch (e) {
      Alert.alert('Action failed', friendlyError(e));
    }
  };

  const makeAdmin = async (m: ChatMessage) => {
    setSelected(null);
    try {
      await rpc(supabase, 'set_room_admin', { p_user: m.sender_id, p_enabled: true });
      Alert.alert('Room admin added', `${displayName(m.sender)} can now help moderate while you're live.`);
    } catch (e) {
      Alert.alert('Could not add admin', friendlyError(e));
    }
  };

  const report = async (m: ChatMessage) => {
    setSelected(null);
    try {
      await rpc(supabase, 'report_content', { p_target_type: 'message', p_target_id: String(m.id), p_reason: 'Reported from live chat' });
      track('report_submitted', { target_type: 'message' });
      Alert.alert('Thanks', 'Our moderators will review this message.');
    } catch (e) {
      Alert.alert('Report failed', friendlyError(e));
    }
  };

  const canActOn = (m: ChatMessage) => canModerate && m.sender_id !== hostId;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 8 }}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        style={{ maxHeight: 260 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => setSelected(item)} onPress={() => onUserPress?.(item.sender_id)} accessibilityHint="Long press for options">
            <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.42)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, marginVertical: 3, maxWidth: '85%' }}>
              <Text color={c.text} style={{ fontSize: 14, lineHeight: 19 }}>
                <Text variant="label" color={item.sender_id === hostId ? c.gold : '#FFB3C1'}>{displayName(item.sender)} </Text>
                {translations[item.id] ?? item.body}
              </Text>
              {translations[item.id] && <Text variant="caption" color={c.textMuted}>Translated · {item.body}</Text>}
            </View>
          </Pressable>
        )}
      />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Say something…"
          placeholderTextColor={c.textMuted}
          maxLength={300}
          onSubmitEditing={send}
          returnKeyType="send"
          accessibilityLabel="Chat message"
          style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.5)', color: c.text, fontFamily: fonts.regular, fontSize: 14 }}
        />
        <Pressable
          onPress={send}
          disabled={sending || !draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', opacity: draft.trim() ? 1 : 0.6 }}
        >
          {sending ? <ActivityIndicator color={c.text} /> : <Ionicons name="send" size={18} color={c.text} />}
        </Pressable>
        {actions}
      </View>

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected ? displayName(selected.sender) : undefined}>
        {selected && (
          <View style={{ gap: 8 }}>
            <Button title="Translate" variant="secondary" onPress={() => translate(selected)} />
            {canActOn(selected) && (
              <>
                <Button title="Mute 10 minutes" variant="secondary" onPress={() => moderate(selected, 'mute', 10)} />
                <Button title="Remove from room" variant="secondary" onPress={() => moderate(selected, 'kick', 60)} />
                <Button title="Block from room" variant="danger" onPress={() => moderate(selected, 'block')} />
              </>
            )}
            {isHost && selected.sender_id !== hostId && <Button title="Make room admin" variant="secondary" onPress={() => makeAdmin(selected)} />}
            <Button title="Report message" variant="ghost" onPress={() => report(selected)} />
          </View>
        )}
      </Sheet>
    </KeyboardAvoidingView>
  );
}
