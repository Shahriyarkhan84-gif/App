import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalParticipant } from '@livekit/components-react';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { FACE_CHECK_EVERY_MS, faceStatus, type FaceStatus } from '@/lib/faceRule';

import type { FaceCheckProps } from './FaceCheck.types';
import { Text } from './ui';

// MediaPipe's face detector, loaded from the CDN only when a web host goes live (Metro can't bundle
// it). Pinned version; the model is MediaPipe's small short-range face detector.
const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

type FaceDetector = { detectForVideo: (video: HTMLVideoElement, timestamp: number) => { detections: unknown[] } };
type Vision = {
  FilesetResolver: { forVisionTasks: (wasmPath: string) => Promise<unknown> };
  FaceDetector: { createFromOptions: (fileset: unknown, options: Record<string, unknown>) => Promise<FaceDetector> };
};
// A real browser import() of a URL, which the bundler leaves alone.
const importUrl = new Function('url', 'return import(url)') as (url: string) => Promise<Vision>;

let detector: Promise<FaceDetector | null> | null = null;
function loadDetector() {
  detector ??= importUrl(LIB)
    .then(async ({ FaceDetector, FilesetResolver }) => FaceDetector.createFromOptions(await FilesetResolver.forVisionTasks(WASM), {
      baseOptions: { modelAssetPath: MODEL },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    }))
    .catch(() => null); // No detector (old browser, blocked download): the rule simply doesn't run.
  return detector;
}

/**
 * Web host: checks the host's own camera on the device (no video leaves it) every 1.5 s. No face
 * for 15 s shows a warning; for 45 s calls onPause. Must render inside <LiveStage>.
 */
export function FaceCheck({ paused, onPause }: FaceCheckProps) {
  const { localParticipant, cameraTrack, isCameraEnabled } = useLocalParticipant();
  const mediaTrack = cameraTrack?.track?.mediaStreamTrack;
  const [status, setStatus] = useState<FaceStatus>({ kind: 'ok' });
  const pauseRef = useRef(onPause);
  useEffect(() => {
    pauseRef.current = onPause;
  }, [onPause]);

  const active = !!mediaTrack && isCameraEnabled && !paused;
  useEffect(() => {
    if (!active || !mediaTrack) return;
    let stopped = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([mediaTrack]);
    void video.play().catch(() => {});
    const since = Date.now();
    let lastFaceAt: number | null = null;
    let fired = false;
    const tick = async () => {
      const d = await loadDetector();
      if (stopped || !d || video.readyState < 2) return;
      try {
        if (d.detectForVideo(video, performance.now()).detections.length > 0) lastFaceAt = Date.now();
      } catch {
        return;
      }
      const next = faceStatus(Date.now(), lastFaceAt, since);
      setStatus(next);
      if (next.kind === 'pause' && !fired) {
        fired = true;
        // Camera off first, so viewers never see the empty frame while the pause is saved.
        void localParticipant.setCameraEnabled(false).catch(() => {});
        pauseRef.current();
      }
    };
    const timer = setInterval(() => void tick(), FACE_CHECK_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      video.srcObject = null;
      setStatus({ kind: 'ok' });
    };
  }, [active, mediaTrack, localParticipant]);

  if (!active || status.kind !== 'warn') return null;
  return (
    <View accessibilityLiveRegion="assertive" style={{ position: 'absolute', left: 12, right: 70, top: 150, flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: 'rgba(225,29,72,0.9)' }}>
      <Ionicons name="scan-outline" size={22} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text variant="label" color="#fff">We can&apos;t see your face</Text>
        <Text variant="caption" color="#fff">Show your face, or your live pauses in {status.pauseInSeconds}s.</Text>
      </View>
    </View>
  );
}
