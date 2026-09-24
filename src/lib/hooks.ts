import { useAuth } from '@clerk/clerk-expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type DependencyList } from 'react';

import { useSupabase } from './supabase';
import { ACTIVE_SUBSCRIPTION_STATUSES, type Subscription } from './types';

type AsyncState<T> = { data: T | undefined; error: Error | null; loading: boolean; reload: () => void };

/** Minimal data-fetching hook; re-runs when deps change or `reload` is called. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  // Identifies the current request; `loading` is true until a result for it lands.
  const key = JSON.stringify([...deps, nonce]);
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: Error | null }>({
    key: null,
    data: undefined,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    fn().then(
      (data) => !cancelled && setState({ key, data, error: null }),
      (e: unknown) =>
        !cancelled && setState((prev) => ({ key, data: prev.data, error: e instanceof Error ? e : new Error(String(e)) })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}

/** Like useAsync, but also refetches whenever the screen regains focus. */
export function useFocusedAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const state = useAsync(fn, deps);
  const { reload } = state;
  const [focusedOnce, setFocusedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce) reload();
      else setFocusedOnce(true);
    }, [focusedOnce, reload]),
  );
  return state;
}

/** Current user's Stripe subscription row (written by the stripe-webhook function). */
export function useSubscription() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const state = useFocusedAsync(async () => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from('subscriptions')
      .select('user_id,status,price_id,current_period_end,cancel_at_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as Subscription | null;
  }, [userId]);

  const isSubscribed = !!state.data && ACTIVE_SUBSCRIPTION_STATUSES.includes(state.data.status);
  return { ...state, subscription: state.data ?? null, isSubscribed };
}
