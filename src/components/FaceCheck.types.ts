export type FaceCheckProps = {
  /** While paused the camera is off and nothing is checked. */
  paused: boolean;
  /** No face for FACE_PAUSE_AFTER_MS: the host's live should pause. */
  onPause: () => void;
};
