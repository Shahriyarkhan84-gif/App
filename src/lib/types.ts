export type Video = {
  id: string;
  title: string;
  description: string;
  genres: string[];
  release_year: number | null;
  duration_seconds: number | null;
  maturity_rating: string | null;
  poster_url: string;
  backdrop_url: string;
  is_premium: boolean;
  featured: boolean;
  created_at: string;
};

export type WatchProgress = {
  video_id: string;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
  videos?: Video;
};

export type Subscription = {
  user_id: string;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];
