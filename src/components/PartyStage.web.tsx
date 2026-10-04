import { isTrackReference, LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import { Track, VideoPresets } from 'livekit-client';
import { useEffect } from 'react';

import { PartySeats } from './PartySeats';
import type { PartyStageProps } from './PartyStage.types';

/** Web party stage (browser WebRTC); same behaviour as the native stage. */
export function PartyStage({ token, url, mode, seats, publishing, micOn, onSeatPress, onDisconnected, onError }: PartyStageProps) {
  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio={publishing}
      video={publishing && mode === 'video' ? { resolution: VideoPresets.h540.resolution } : false}
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={onDisconnected}
      onError={onError}
    >
      <Seats mode={mode} seats={seats} publishing={publishing} micOn={micOn} onSeatPress={onSeatPress} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function Seats({ mode, seats, publishing, micOn, onSeatPress }: Pick<PartyStageProps, 'mode' | 'seats' | 'publishing' | 'micOn' | 'onSeatPress'>) {
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera]);
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (publishing) void localParticipant.setMicrophoneEnabled(micOn);
  }, [publishing, micOn, localParticipant]);

  const speaking = new Set(participants.filter((p) => p.isSpeaking).map((p) => p.identity));
  return (
    <PartySeats
      mode={mode}
      seats={seats}
      speaking={speaking}
      onSeatPress={onSeatPress}
      renderVideo={(userId) => {
        const ref = tracks.find((t) => isTrackReference(t) && t.participant.identity === userId);
        return ref && isTrackReference(ref) ? <VideoTrack trackRef={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null;
      }}
    />
  );
}
