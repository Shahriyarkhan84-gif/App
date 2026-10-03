// Live pipeline → upload pipeline: records a live host with LiveKit participant
// egress straight into the private `uploads` bucket (via Supabase Storage's
// S3-compatible endpoint), so the replay goes through the same HDR detection
// and adaptive-bitrate ladder as uploads. Enabled by platform_settings
// media.record_live; needs the STORAGE_S3_* variables (see docs/ENVIRONMENT.md).
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from 'npm:livekit-server-sdk@2';

import { requireEnv } from './cors.ts';
import { livekitApiHost, RECORDINGS_BUCKET, recordingPath } from './recording.ts';

export async function startHostRecording(livekitRoom: string, hostId: string, now = new Date()): Promise<string> {
  const client = new EgressClient(
    livekitApiHost(requireEnv('LIVEKIT_URL')),
    requireEnv('LIVEKIT_API_KEY'),
    requireEnv('LIVEKIT_API_SECRET'),
  );
  const file = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: recordingPath(hostId, now),
    output: {
      case: 's3',
      value: new S3Upload({
        endpoint: requireEnv('STORAGE_S3_ENDPOINT'),
        region: Deno.env.get('STORAGE_S3_REGION') ?? 'us-east-1',
        accessKey: requireEnv('STORAGE_S3_ACCESS_KEY'),
        secret: requireEnv('STORAGE_S3_SECRET'),
        bucket: RECORDINGS_BUCKET,
        forcePathStyle: true,
      }),
    },
  });
  const info = await client.startParticipantEgress(livekitRoom, hostId, { file });
  return info.egressId;
}
