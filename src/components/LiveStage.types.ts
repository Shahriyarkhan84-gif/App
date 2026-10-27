import type { ReactNode } from 'react';

export type LiveStageProps = {
  token: string;
  url: string;
  /** 'guest': a viewer the host brought on (publishes camera + mic, shown in the corner tile). */
  role: 'viewer' | 'host' | 'guest';
  /** The host's identity, so a guest's video never takes the main screen. */
  hostId?: string;
  /** Host camera: front (default) or back, chosen with Flip before going live. */
  facing?: 'user' | 'environment';
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  /** Rendered inside the LiveKit room (e.g. host controls that need the room's hooks). */
  children?: ReactNode;
};
