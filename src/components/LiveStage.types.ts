export type LiveStageProps = {
  token: string;
  url: string;
  role: 'viewer' | 'host';
  /** Host camera: front (default) or back, chosen with Flip before going live. */
  facing?: 'user' | 'environment';
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
};
