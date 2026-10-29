import Ionicons from '@expo/vector-icons/Ionicons';
import { useConnectionQualityIndicator, useConnectionState, useLocalParticipant } from '@livekit/components-react';
import { ConnectionQuality, ConnectionState } from 'livekit-client';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Alert } from '@/lib/alert';
import { liveColors as c } from '@/lib/theme';

import { Button, Text } from './ui';

// Host controls that act on the LiveKit room, so they must render inside <LiveStage> (its children).
// The camera and room tools themselves are in HostToolsSheet.

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
