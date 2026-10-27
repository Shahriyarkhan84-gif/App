import Ionicons from '@expo/vector-icons/Ionicons';
import { useConnectionQualityIndicator, useConnectionState, useLocalParticipant } from '@livekit/components-react';
import { ConnectionQuality, ConnectionState, type LocalVideoTrack } from 'livekit-client';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, View } from 'react-native';

import { Alert } from '@/lib/alert';
import { liveColors as c } from '@/lib/theme';

import { useFacing } from './liveFacing';
import { Button, Text } from './ui';

// Host controls that act on the LiveKit room, so they must render inside <LiveStage> (its children).

type Icon = ComponentProps<typeof Ionicons>['name'];

function RailButton({ icon, label, onPress, active, warn, disabled }: { icon: Icon; label: string; onPress: () => void; active?: boolean; warn?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} hitSlop={4}
      style={{ alignItems: 'center', gap: 3, opacity: disabled ? 0.45 : 1 }}>
      <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: warn ? 'rgba(255,90,97,0.92)' : 'rgba(255,255,255,0.16)' }}>
        <Ionicons name={icon} size={21} color="#fff" />
      </View>
      <Text variant="caption" color="#fff" style={{ fontSize: 10, lineHeight: 12 }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Right-side control rail (Bigo/TikTok style): flip camera, mic, camera, then the screen's own
 * actions (battle, share). Mic/camera state comes from LiveKit, so it is always what viewers get.
 */
export function HostControlRail({ top, onBattle, battleLabel, onShare, onGuests, guestRequests = 0, compact }: { top: number; onBattle?: () => void; battleLabel?: string; onShare: () => void; onGuests?: () => void; guestRequests?: number; compact?: boolean }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, cameraTrack } = useLocalParticipant();
  const { facing, setFacing } = useFacing();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, failed: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch {
      Alert.alert(failed, 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const flip = () => run(async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    const track = cameraTrack?.track as LocalVideoTrack | undefined;
    if (track) await track.restartTrack({ facingMode: next });
    setFacing(next);
  }, "Couldn't switch camera");

  return (
    <View style={{ position: 'absolute', right: 10, top, gap: 12, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' }}>
      <RailButton icon="camera-reverse-outline" label="Flip" onPress={flip} disabled={!isCameraEnabled || busy} />
      <RailButton icon={isMicrophoneEnabled ? 'mic-outline' : 'mic-off'} label={isMicrophoneEnabled ? 'Mic' : 'Mic off'} warn={!isMicrophoneEnabled}
        onPress={() => run(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled), "Couldn't change the mic")} disabled={busy} />
      <RailButton icon={isCameraEnabled ? 'videocam-outline' : 'videocam-off'} label={isCameraEnabled ? 'Camera' : 'Cam off'} warn={!isCameraEnabled}
        onPress={() => run(() => localParticipant.setCameraEnabled(!isCameraEnabled), "Couldn't change the camera")} disabled={busy} />
      {/* In a PK battle the rail sits in the host's half of the split: camera and mic only. */}
      {!compact && onBattle && <RailButton icon="flash-outline" label={battleLabel ?? 'Battle'} onPress={onBattle} />}
      {!compact && onGuests && <RailButton icon="people-outline" label={guestRequests ? `Guests ${guestRequests}` : 'Guests'} active={guestRequests > 0} onPress={onGuests} />}
      {!compact && <RailButton icon="share-social-outline" label="Share" onPress={onShare} />}
    </View>
  );
}

/** "Your mic is off" reminder, so the host doesn't talk to viewers who can't hear them. */
export function MicOffBanner() {
  const { isMicrophoneEnabled } = useLocalParticipant();
  if (isMicrophoneEnabled) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,90,97,0.88)' }}>
      <Ionicons name="mic-off" size={14} color="#fff" />
      <Text variant="label" color="#fff" style={{ fontSize: 12 }}>Your mic is off</Text>
    </View>
  );
}

/** Connection badge: Reconnecting… / Weak network / Good, from LiveKit's own measurements. */
export function ConnectionBadge() {
  const state = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });
  const [label, color] =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting ? ['Reconnecting…', c.warning]
      : state !== ConnectionState.Connected ? ['Connecting…', c.textMuted]
        : quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost ? ['Weak network', c.danger]
          : quality === ConnectionQuality.Good ? ['OK', c.warning]
            : ['Good', c.success];
  return (
    <View accessibilityLabel={`Connection: ${label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <Ionicons name="cellular" size={12} color={color} />
      <Text variant="caption" color={color} style={{ fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** How long the host has been live (hh:mm:ss), ticking every second without re-rendering the screen. */
export function LiveTimer({ since }: { since: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <View accessibilityLabel={`Live for ${Math.floor(s / 60)} minutes`} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <Text variant="caption" color="#fff" style={{ fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{pad(Math.floor(s / 3600))}:{pad(Math.floor(s / 60) % 60)}:{pad(s % 60)}</Text>
    </View>
  );
}

/**
 * The live is paused by the no-face rule (camera off; viewers see "Host will be right back").
 * Resume turns the camera back on. Must render inside <LiveStage>.
 */
export function LivePausedCard({ onResume }: { onResume: () => void }) {
  const { localParticipant } = useLocalParticipant();
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      await localParticipant.setCameraEnabled(true);
      onResume();
    } catch {
      Alert.alert("Couldn't turn the camera on", 'Check camera permission and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ position: 'absolute', left: 24, right: 24, top: '30%', gap: 10, padding: 18, borderRadius: 20, backgroundColor: 'rgba(6,24,38,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }}>
      <Ionicons name="pause-circle" size={34} color="#fff" />
      <Text variant="h3" color="#fff">Live paused</Text>
      <Text variant="bodySmall" color="#D6F0FF">We couldn&apos;t see your face for a while. Hosts must be on camera while live. Viewers see &quot;Host will be right back&quot;.</Text>
      <Button title="I'm back, resume" onPress={() => void resume()} loading={busy} />
    </View>
  );
}
