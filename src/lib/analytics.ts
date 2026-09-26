import { usePostHog } from 'posthog-react-native';
import { useCallback } from 'react';

type AnalyticsEvent =
  | { name: 'room_joined'; props: { room_id: string } }
  | { name: 'went_live'; props: { category: string } }
  | { name: 'cover_set'; props: Record<string, never> }
  | { name: 'live_ended'; props: { room_id: string } }
  | { name: 'gift_sent'; props: { room_id: string; gift_id: number; coins: number } }
  | { name: 'chat_sent'; props: { room_id: string } }
  | { name: 'follow_toggled'; props: { user_id: string; following: boolean } }
  | { name: 'coin_checkout_started'; props: { package_id: number } }
  | { name: 'withdrawal_requested'; props: { coins: number } }
  | { name: 'report_submitted'; props: { target_type: string } }
  | { name: 'became_host'; props: Record<string, never> }
  | { name: 'feedback_opened'; props: Record<string, never> }
  | { name: 'account_deleted'; props: Record<string, never> }
  | { name: 'host_application_submitted'; props: { status: string } }
  | { name: 'pk_battle_invited'; props: { room_id: string; target_room_id: string } }
  | { name: 'pk_battle_accepted'; props: { battle_id: string } }
  | { name: 'pk_battle_declined'; props: { battle_id: string } }
  | { name: 'pk_battle_ended'; props: { battle_id: string } }
  | { name: 'room_shared'; props: { room_id: string } }
  | { name: 'profile_shared'; props: { user_id: string } };

/** Typed PostHog capture; no-op when PostHog isn't configured. */
export function useAnalytics() {
  const posthog = usePostHog();
  return useCallback(
    <E extends AnalyticsEvent>(name: E['name'], props: E['props']) => {
      posthog?.capture(name, props);
    },
    [posthog],
  );
}
