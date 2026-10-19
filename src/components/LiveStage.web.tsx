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
export function LiveStage({ token, url, role, facing: initialFacing = 'user', onDisconnected, onError, children }: LiveStageProps) {
  const [facing, setFacing] = useState<Facing>(initialFacing);
  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio={role === 'host'}
      video={role === 'host' ? { resolution: VideoPresets.h1080.resolution } : false}
      options={{
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720] },
      }}
      onDisconnected={onDisconnected}
      onError={onError}
      style={{ position: 'absolute', inset: 0 }}
    >
      <FacingContext.Provider value={{ facing, setFacing }}>
        <Stage role={role} />
        {children}
      </FacingContext.Provider>
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function Stage({ role }: { role: LiveStageProps['role'] }) {
  const tracks = useTracks([Track.Source.Camera]);
  const { facing } = useFacing();
  const { isCameraEnabled } = useLocalParticipant();
  const trackRef = tracks.find((t) => isTrackReference(t) && (role === 'host' ? t.participant.isLocal : !t.participant.isLocal));
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
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: role === 'host' && facing === 'user' ? 'scaleX(-1)' : undefined }}
    />
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
});
