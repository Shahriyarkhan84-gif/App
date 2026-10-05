import { AudioSession, isTrackReference, LiveKitRoom, useLocalParticipant, useParticipants, useConnectionState, useTracks, VideoTrack } from '@livekit/react-native';
import { ConnectionState, Track, VideoPresets } from 'livekit-client';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { PartySeats } from './PartySeats';
import type { PartyStageProps } from './PartyStage.types';

/** Native party stage: everyone on a seat publishes; the seat grid shows who's talking. */
export function PartyStage({ token, url, mode, seats, publishing, micOn, onSeatPress, onDisconnected, onError }: PartyStageProps) {
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
      // Join muted if the mic is off: connecting must never switch a muted mic on.
      audio={publishing && micOn}
      video={publishing && mode === 'video' ? { resolution: VideoPresets.h540.resolution, facingMode: 'user' } : false}
      options={{ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true }}
      onDisconnected={onDisconnected}
      onError={onError}
    >
      <Seats mode={mode} seats={seats} publishing={publishing} micOn={micOn} onSeatPress={onSeatPress} />
    </LiveKitRoom>
  );
}

function Seats({ mode, seats, publishing, micOn, onSeatPress }: Pick<PartyStageProps, 'mode' | 'seats' | 'publishing' | 'micOn' | 'onSeatPress'>) {
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera]);
  const { localParticipant } = useLocalParticipant();

  // Re-apply once connected too (a reconnect or remount must keep a muted mic muted).
  const connection = useConnectionState();
  useEffect(() => {
    if (publishing && connection === ConnectionState.Connected) void localParticipant.setMicrophoneEnabled(micOn);
  }, [publishing, micOn, localParticipant, connection]);

  const speaking = new Set(participants.filter((p) => p.isSpeaking).map((p) => p.identity));
  return (
    <PartySeats
      mode={mode}
      seats={seats}
      speaking={speaking}
      onSeatPress={onSeatPress}
      renderVideo={(userId) => {
        const ref = tracks.find((t) => isTrackReference(t) && t.participant.identity === userId);
        return ref && isTrackReference(ref) ? <VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit="cover" mirror={ref.participant.isLocal} /> : null;
      }}
    />
  );
}
