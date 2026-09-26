import { AudioSession, isTrackReference, LiveKitRoom, useTracks, VideoTrack } from '@livekit/react-native';
import { Track, VideoPresets } from 'livekit-client';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { liveColors } from '@/lib/theme';

import type { LiveStageProps } from './LiveStage.types';
import { Text } from './ui';

/**
 * Native LiveKit stage. Viewers subscribe with adaptive streaming (LiveKit picks
 * the simulcast layer that fits the viewer's bandwidth/screen); hosts publish
 * 1080p with simulcast so lower layers are available as fallbacks.
 */
export function LiveStage({ token, url, role, onDisconnected, onError }: LiveStageProps) {
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
      video={role === 'host' ? { resolution: VideoPresets.h1080.resolution, facingMode: 'user' } : false}
      options={{
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
        publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720] },
      }}
      onDisconnected={onDisconnected}
      onError={onError}
    >
      <Stage role={role} />
    </LiveKitRoom>
  );
}

export function Stage({ role }: { role: LiveStageProps['role'] }) {
  const tracks = useTracks([Track.Source.Camera]);
  const trackRef = tracks.find((t) => isTrackReference(t) && (role === 'host' ? t.participant.isLocal : !t.participant.isLocal));

  if (!trackRef || !isTrackReference(trackRef)) {
    return (
      <View style={styles.waiting}>
        <ActivityIndicator color={liveColors.text} />
        <Text color={liveColors.textMuted}>{role === 'host' ? 'Starting camera…' : 'Connecting to the stream…'}</Text>
      </View>
    );
  }
  return <VideoTrack trackRef={trackRef} style={StyleSheet.absoluteFill} objectFit="cover" mirror={role === 'host'} />;
}

const styles = StyleSheet.create({
  waiting: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#000' },
});
