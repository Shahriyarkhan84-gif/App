import type { ReactNode } from 'react';

export type LiveStageProps = {
  token: string;
  url: string;
  role: 'viewer' | 'host';
  /** Host camera: front (default) or back, chosen with Flip before going live. */
  facing?: 'user' | 'environment';
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  /** Rendered inside the LiveKit room (e.g. host controls that need the room's hooks). */
  children?: ReactNode;
};
