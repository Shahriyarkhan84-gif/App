import { usePostHog } from 'posthog-react-native';
import { useCallback } from 'react';

type AnalyticsEvent =
  | { name: 'video_opened'; props: { video_id: string; title: string } }
  | { name: 'video_started'; props: { video_id: string; resumed_from: number } }
  | { name: 'video_completed'; props: { video_id: string } }
  | { name: 'watchlist_toggled'; props: { video_id: string; added: boolean } }
  | { name: 'search_performed'; props: { query: string; results: number; source: 'semantic' | 'keyword' } }
  | { name: 'paywall_viewed'; props: { video_id?: string } }
  | { name: 'checkout_started'; props: { plan: string } }
  | { name: 'feedback_opened'; props: Record<string, never> };

/** Typed wrapper around PostHog capture. No-ops when PostHog isn't configured. */
export function useAnalytics() {
  const posthog = usePostHog();
  return useCallback(
    <E extends AnalyticsEvent>(name: E['name'], props: E['props']) => {
      posthog?.capture(name, props);
    },
    [posthog],
  );
}
