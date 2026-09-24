export type LiveStageProps = {
  token: string;
  url: string;
  role: 'viewer' | 'host';
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
};
