import { isTrackReference, LiveKitRoom, RoomAudioRenderer, useTracks, VideoTrack } from '@livekit/components-react';
import { Track, VideoPresets } from 'livekit-client';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { liveColors } from '@/lib/theme';

import type { LiveStageProps } from './LiveStage.types';
import { Text } from './ui';

/** Web LiveKit stage (browser WebRTC); same behaviour as the native stage. */
export function LiveStage({ token, url, role, onDisconnected, onError }: LiveStageProps) {
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
      <Stage role={role} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function Stage({ role }: { role: LiveStageProps['role'] }) {
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
  return (
    <VideoTrack
      trackRef={trackRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: role === 'host' ? 'scaleX(-1)' : undefined }}
    />
  );
}

const styles = StyleSheet.create({
  waiting: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#000' },
});
