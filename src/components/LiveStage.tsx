import { AudioSession, isTrackReference, LiveKitRoom, useLocalParticipant, useTracks, VideoTrack } from '@livekit/react-native';
import { Track, VideoPresets } from 'livekit-client';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { liveColors } from '@/lib/theme';

import { type Facing, FacingContext, useFacing } from './liveFacing';
import type { LiveStageProps } from './LiveStage.types';
import { Text } from './ui';

/**
 * Native LiveKit stage. Viewers subscribe with adaptive streaming (LiveKit picks
 * the simulcast layer that fits the viewer's bandwidth/screen); hosts publish
 * 1080p with simulcast so lower layers are available as fallbacks.
 */
export function LiveStage({ token, url, role, facing: initialFacing = 'user', onDisconnected, onError, children }: LiveStageProps) {
  // The camera chosen before going live; the Flip control changes it while live.
  const [facing, setFacing] = useState<Facing>(initialFacing);
  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, []);

  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio={role === 'host'}
      video={role === 'host' ? { resolution: VideoPresets.h1080.resolution, facingMode: initialFacing } : false}
      options={{
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
        publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720] },
      }}
      onDisconnected={onDisconnected}
      onError={onError}
    >
      <FacingContext.Provider value={{ facing, setFacing }}>
        <Stage role={role} />
        {children}
      </FacingContext.Provider>
    </LiveKitRoom>
  );
}

export function Stage({ role }: { role: LiveStageProps['role'] }) {
  const tracks = useTracks([Track.Source.Camera]);
  const { facing } = useFacing();
  const { isCameraEnabled } = useLocalParticipant();
  const trackRef = tracks.find((t) => isTrackReference(t) && (role === 'host' ? t.participant.isLocal : !t.participant.isLocal));

  // Host turned the camera off: say so instead of a black screen (viewers still hear the host).
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
  // Only the front camera is mirrored for the host (like a mirror); the back camera shows the room as it is.
  return <VideoTrack trackRef={trackRef} style={StyleSheet.absoluteFill} objectFit="cover" mirror={role === 'host' && facing === 'user'} />;
}

/** A muted, view-only connection to another room (the PK opponent's half of the split). */
export function OpponentStage({ token, url }: { token: string; url: string }) {
  return (
    <LiveKitRoom serverUrl={url} token={token} connect audio={false} video={false}>
      <Stage role="viewer" />
    </LiveKitRoom>
  );
}

const styles = StyleSheet.create({
  waiting: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#000' },
});
