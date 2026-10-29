import { isTrackReference, LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useTracks, VideoTrack } from '@livekit/components-react';
import { Track, VideoPresets } from 'livekit-client';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { liveColors } from '@/lib/theme';

import { type Facing, FacingContext, useFacing } from './liveFacing';
import type { LiveStageProps } from './LiveStage.types';
import { Text } from './ui';

/** Web LiveKit stage (browser WebRTC); same behaviour as the native stage. */
export function LiveStage({ token, url, role, hostId, facing: initialFacing = 'user', onDisconnected, onError, children }: LiveStageProps) {
  const [facing, setFacing] = useState<Facing>(initialFacing);
  const [mirror, setMirror] = useState(true);
  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio={role !== 'viewer'}
      video={role === 'host' ? { resolution: VideoPresets.h1080.resolution } : role === 'guest' ? { resolution: VideoPresets.h720.resolution } : false}
      options={{
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720] },
      }}
      onDisconnected={onDisconnected}
      onError={onError}
      style={{ position: 'absolute', inset: 0 }}
    >
      <FacingContext.Provider value={{ facing, setFacing, mirror, setMirror }}>
        <Stage role={role} hostId={hostId} />
        <GuestTile role={role} hostId={hostId} />
        {children}
      </FacingContext.Provider>
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function Stage({ role, hostId }: { role: LiveStageProps['role']; hostId?: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  const { facing, mirror } = useFacing();
  const { isCameraEnabled } = useLocalParticipant();
  // The host's own camera, or (watching) the host's: never a guest's, whoever published first.
  const trackRef = tracks.find((t) => isTrackReference(t) && (role === 'host' ? t.participant.isLocal
    : !t.participant.isLocal && (!hostId || t.participant.identity === hostId)));
  if (role === 'host' ? !isCameraEnabled && !!trackRef : trackRef && isTrackReference(trackRef) && trackRef.publication.isMuted) {
    return (
      <View style={styles.waiting}>
        <Ionicons name="videocam-off" size={36} color={liveColors.textMuted} />
        <Text color={liveColors.textMuted}>{role === 'host' ? 'Your camera is off' : 'The host turned the camera off'}</Text>
      </View>
    );
  }
  if (!trackRef || !isTrackReference(trackRef)) {
    return (
      <View style={styles.waiting}>
        <ActivityIndicator color={liveColors.text} />
        <Text color={liveColors.textMuted}>{role === 'host' ? 'Starting camera…' : 'Connecting to the stream…'}</Text>
      </View>
    );
  }
  return (
    <VideoTrack
      trackRef={trackRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: role === 'host' && facing === 'user' && mirror ? 'scaleX(-1)' : undefined }}
    />
  );
}

/** The guest's camera in the top-left corner (the host's controls sit on the right) (solo lives with a guest on). */
function GuestTile({ role, hostId }: { role: LiveStageProps['role']; hostId?: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  if (!hostId && role !== 'host') return null;
  const guest = tracks.find((t) => isTrackReference(t) && (role === 'guest' ? t.participant.isLocal
    : !t.participant.isLocal && t.participant.identity !== hostId));
  if (!guest || !isTrackReference(guest)) return null;
  return (
    <View pointerEvents="none" style={styles.guest} accessibilityLabel={`Guest: ${guest.participant.name ?? ''}`}>
      <VideoTrack trackRef={guest} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: role === 'guest' ? 'scaleX(-1)' : undefined }} />
      <Text variant="caption" color="#fff" numberOfLines={1} style={styles.guestName}>{role === 'guest' ? 'You' : guest.participant.name}</Text>
    </View>
  );
}

/** A muted, view-only connection to another room (the PK opponent's half of the split). */
export function OpponentStage({ token, url }: { token: string; url: string }) {
  return (
    <LiveKitRoom serverUrl={url} token={token} connect audio={false} video={false} style={{ position: 'absolute', inset: 0 }}>
      <Stage role="viewer" />
    </LiveKitRoom>
  );
}

const styles = StyleSheet.create({
  waiting: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#000' },
  guest: { position: 'absolute', left: 12, top: 150, width: 112, height: 160, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: '#FFC24B', backgroundColor: '#061826' },
  guestName: { position: 'absolute', left: 6, right: 6, bottom: 4, fontSize: 11 },
});
