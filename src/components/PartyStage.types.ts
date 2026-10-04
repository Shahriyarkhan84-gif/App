import type { PartyMode, Seat } from './PartySeats';

export type PartyStageProps = {
  token: string;
  url: string;
  mode: PartyMode;
  seats: Seat[];
  /** Publish your mic (host or seated guest); video parties also publish your camera. */
  publishing: boolean;
  micOn: boolean;
  onSeatPress?: (seat: Seat) => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
};
