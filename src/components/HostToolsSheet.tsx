import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalParticipant } from '@livekit/components-react';
import { type LocalVideoTrack, VideoPresets } from 'livekit-client';
import { useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Alert } from '@/lib/alert';
import { invokeFn, rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName } from '@/lib/types';

import { useFacing } from './liveFacing';
import { Avatar, Button, Row, Sheet, Text } from './ui';

type Icon = ComponentProps<typeof Ionicons>['name'];
type Panel = 'main' | 'sticker' | 'comments' | 'newcomers';

export const LIVE_STICKERS = ['🌸', '✨', '💖', '🎉', '👑', '🔥', '🎵', '☕', '🌙', '🌈', '🎂', '🇵🇰'] as const;

function Tool({ icon, label, onPress, active, dot, disabled }: { icon: Icon; label: string; onPress: () => void; active?: boolean; dot?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }}
      style={{ width: '20%', alignItems: 'center', gap: 6, paddingVertical: 6, opacity: disabled ? 0.4 : 1 }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? c.primary : c.surfaceRaised, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Ionicons name={icon} size={23} color={active ? c.primaryText : c.text} />
        {dot && <View style={{ position: 'absolute', top: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: c.danger, borderWidth: 2, borderColor: c.surface }} />}
      </View>
      <Text variant="caption" color={c.textMuted} numberOfLines={1} style={{ fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}

const Section = ({ title }: { title: string }) => <Text variant="label" color={c.text} style={{ fontSize: 15, marginTop: 4 }}>{title}</Text>;

/**
 * Host tools (opened from the tools button in the host's bottom bar). Room tools act on the camera
 * and the room; Other tools open small panels here. Must render inside <LiveStage> (camera tools
 * read the LiveKit room).
 */
export function HostToolsSheet({ visible, onClose, roomId, sticker, onShare, onPk, onGuests, guestRequests }: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  sticker: string | null;
  onShare: () => void;
  onPk?: () => void;
  onGuests: () => void;
  guestRequests: number;
}) {
  const supabase = useSupabase();
  const { localParticipant, isMicrophoneEnabled, cameraTrack } = useLocalParticipant();
  const { facing, setFacing, mirror, setMirror } = useFacing();
  const [panel, setPanel] = useState<Panel>('main');
  const [hd, setHd] = useState(true);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => { setPanel('main'); onClose(); };
  const run = async (key: string, fn: () => Promise<unknown>, failed: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert(failed, friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  const track = cameraTrack?.track as LocalVideoTrack | undefined;
  const flip = () => run('flip', async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    if (track) await track.restartTrack({ facingMode: next, resolution: (hd ? VideoPresets.h1080 : VideoPresets.h720).resolution });
    setFacing(next);
  }, "Couldn't switch camera");
  // HD: 1080p for a strong connection, 720p to save data on a weak one.
  const toggleHd = () => run('hd', async () => {
    if (track) await track.restartTrack({ facingMode: facing, resolution: (hd ? VideoPresets.h720 : VideoPresets.h1080).resolution });
    setHd(!hd);
  }, "Couldn't change the quality");
  const toggleRecorder = () => run('rec', async () => {
    const r = await invokeFn<{ recording: boolean }>(supabase, 'live-record', { on: !recording });
    setRecording(r.recording);
    Alert.alert(r.recording ? 'Recording' : 'Recording stopped', r.recording ? 'Your live is being saved. The replay appears on your profile after you end.' : 'The part you recorded will appear on your profile.');
  }, "Couldn't change recording");

  return (
    <Sheet visible={visible} onClose={close} tone="live">
      {panel !== 'main' && (
        <Pressable onPress={() => setPanel('main')} accessibilityRole="button" accessibilityLabel="Back to tools" hitSlop={8}>
          <Row gap={6}>
            <Ionicons name="chevron-back" size={22} color={c.text} />
            <Text variant="h2" color={c.text}>{PANEL_TITLE[panel]}</Text>
          </Row>
        </Pressable>
      )}
      {panel === 'main' && (
        <ScrollView>
          <Section title="Room tools" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
            <Tool icon="share-social-outline" label="Share" onPress={() => { close(); onShare(); }} />
            <Tool icon="swap-horizontal-outline" label="Mirror" active={mirror} onPress={() => setMirror(!mirror)} disabled={facing !== 'user'} />
            <Tool icon="camera-reverse-outline" label="Flip" onPress={flip} disabled={busy !== null} />
            <Tool icon="sparkles-outline" label={hd ? 'HD on' : 'HD off'} active={hd} onPress={toggleHd} disabled={busy !== null} />
            <Tool icon="happy-outline" label="Sticker" active={!!sticker} onPress={() => setPanel('sticker')} />
            <Tool icon={isMicrophoneEnabled ? 'mic-outline' : 'mic-off-outline'} label={isMicrophoneEnabled ? 'Mic' : 'Mic off'} active={!isMicrophoneEnabled}
              onPress={() => run('mic', () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled), "Couldn't change the mic")} />
            {onPk && <Tool icon="flash-outline" label="PK" onPress={() => { close(); onPk(); }} />}
          </View>
          <Section title="Other tools" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
            <Tool icon="people-outline" label={guestRequests ? `Guests ${guestRequests}` : 'Guests'} dot={guestRequests > 0} onPress={() => { close(); onGuests(); }} />
            <Tool icon="chatbox-ellipses-outline" label="Comments" onPress={() => setPanel('comments')} />
            <Tool icon="videocam-outline" label={recording ? 'Recording' : 'Recorder'} active={recording} onPress={toggleRecorder} disabled={busy !== null} />
            <Tool icon="person-add-outline" label="Newcomers" onPress={() => setPanel('newcomers')} />
          </View>
        </ScrollView>
      )}
      {panel === 'sticker' && <StickerPanel roomId={roomId} current={sticker} onDone={close} />}
      {panel === 'comments' && <CommentsPanel roomId={roomId} onDone={close} />}
      {panel === 'newcomers' && <NewcomersPanel roomId={roomId} />}
    </Sheet>
  );
}

const PANEL_TITLE: Record<Exclude<Panel, 'main'>, string> = {
  sticker: 'Sticker', comments: 'Comments', newcomers: 'Newcomers',
};

function StickerPanel({ roomId, current, onDone }: { roomId: string; current: string | null; onDone: () => void }) {
  const supabase = useSupabase();
  const set = async (s: string | null) => {
    try {
      await rpc(supabase, 'set_live_sticker', { p_sticker: s });
      onDone();
    } catch (e) {
      Alert.alert("Couldn't set the sticker", friendlyError(e));
    }
  };
  return (
    <View style={{ gap: 12 }} key={roomId}>
      <Text variant="caption" color={c.textMuted}>Shows in the corner of your live for everyone.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {LIVE_STICKERS.map((s) => (
          <Pressable key={s} onPress={() => void set(s)} accessibilityRole="button" accessibilityLabel={`Sticker ${s}`}
            style={{ width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: current === s ? 'rgba(125,211,252,0.18)' : c.surfaceRaised, borderWidth: current === s ? 1.5 : 0, borderColor: c.primary }}>
            <Text style={{ fontSize: 30, lineHeight: 36 }}>{s}</Text>
          </Pressable>
        ))}
      </View>
      {current && <Button title="Remove sticker" variant="secondary" onPress={() => void set(null)} />}
    </View>
  );
}

const CHAT_MODES = [['everyone', 'Everyone'], ['followers', 'Followers only'], ['off', 'Off']] as const;
const SLOW = [[0, 'Off'], [5, '5 s'], [10, '10 s'], [30, '30 s']] as const;

function CommentsPanel({ roomId, onDone }: { roomId: string; onDone: () => void }) {
  const supabase = useSupabase();
  const current = useAsync(async () => {
    const { data } = await supabase.from('rooms').select('chat_mode,chat_slow_seconds').eq('id', roomId).maybeSingle();
    return (data as { chat_mode?: string; chat_slow_seconds?: number } | null) ?? null;
  }, [roomId]);
  const [mode, setMode] = useState<string | null>(null);
  const [slow, setSlow] = useState<number | null>(null);
  const m = mode ?? current.data?.chat_mode ?? 'everyone';
  const s = slow ?? current.data?.chat_slow_seconds ?? 0;
  const save = async () => {
    try {
      await rpc(supabase, 'set_chat_settings', { p_mode: m, p_slow_seconds: s });
      onDone();
    } catch (e) {
      Alert.alert("Couldn't save", friendlyError(e));
    }
  };
  const chip = (on: boolean, label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: on ? c.primary : c.surfaceRaised }}>
      <Text variant="label" color={on ? c.primaryText : c.text} style={{ fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }}>
      <Text variant="caption" color={c.textMuted}>Who can comment in your live</Text>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>{CHAT_MODES.map(([id, label]) => chip(m === id, label, () => setMode(id)))}</Row>
      <Text variant="caption" color={c.textMuted}>Slow mode: one comment per person every…</Text>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>{SLOW.map(([v, label]) => chip(s === v, label, () => setSlow(v)))}</Row>
      <Text variant="caption" color={c.textFaint}>You and your room admins can always comment.</Text>
      <Button title="Save" onPress={() => void save()} />
    </View>
  );
}

type Newcomer = { user_id: string; display_name: string | null; username: string | null; avatar_url: string | null };

function NewcomersPanel({ roomId }: { roomId: string }) {
  const supabase = useSupabase();
  const list = useAsync(async () => rpc<Newcomer[]>(supabase, 'live_newcomers'), [roomId]);
  const [welcomed, setWelcomed] = useState<Set<string>>(() => new Set());
  const welcome = async (n: Newcomer) => {
    try {
      await rpc(supabase, 'send_chat_message', { p_room: roomId, p_body: `Welcome ${displayName(n)} 👋` });
      setWelcomed((w) => new Set(w).add(n.user_id));
    } catch (e) {
      Alert.alert("Couldn't send", friendlyError(e));
    }
  };
  const rows = list.data ?? [];
  return (
    <View style={{ gap: 8 }}>
      <Text variant="caption" color={c.textMuted}>Watching you for the first time. A welcome makes them stay.</Text>
      {list.loading && !list.data ? <Text color={c.textMuted}>Loading…</Text>
        : rows.length === 0 ? <Text color={c.textMuted} style={{ paddingVertical: 12 }}>No new viewers right now.</Text>
        : (
          <ScrollView style={{ maxHeight: 320 }}>
            {rows.map((n) => (
              <Row key={n.user_id} style={{ paddingVertical: 8 }}>
                <Avatar uri={n.avatar_url} name={displayName(n)} size={40} />
                <Text variant="label" color={c.text} numberOfLines={1} style={{ flex: 1 }}>{displayName(n)}</Text>
                <Button title={welcomed.has(n.user_id) ? 'Welcomed' : 'Welcome'} size="sm" variant={welcomed.has(n.user_id) ? 'secondary' : 'primary'}
                  disabled={welcomed.has(n.user_id)} onPress={() => void welcome(n)} />
              </Row>
            ))}
          </ScrollView>
        )}
    </View>
  );
}
