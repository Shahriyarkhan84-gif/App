import type { FaceCheckProps } from './FaceCheck.types';

/**
 * The phone apps have no on-device face detector yet (LiveKit owns the camera, and a detector
 * needs a native module in a new app build), so the no-face rule runs on the web host only.
 */
export function FaceCheck(_props: FaceCheckProps) {
  return null;
}
