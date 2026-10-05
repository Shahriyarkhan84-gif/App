import { useFocusEffect } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

import { useSupabase } from './supabase';

type AsyncState<T> = { data: T | undefined; error: Error | null; loading: boolean; reload: () => void };

// Last result per cacheKey, for this app session only (memory, cleared when the app closes).
const cache = new Map<string, unknown>();

/**
 * Minimal data-fetching hook; re-runs when deps change or `reload` is called.
 * With a `cacheKey`, a screen opens showing its last result at once while fresh data loads
 * (the server is far away, so a cold load takes a second or more). Include the user id in
 * the key so one account never sees another's data.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, cacheKey?: string): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  // Identifies the current request; `loading` is true until a result for it lands.
  const key = JSON.stringify([...deps, nonce]);
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: Error | null }>({
    key: null,
    data: cacheKey ? (cache.get(cacheKey) as T | undefined) : undefined,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    fn().then(
      (data) => {
        if (cancelled) return;
        if (cacheKey) cache.set(cacheKey, data);
        setState({ key, data, error: null });
      },
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
export function useFocusedAsync<T>(fn: () => Promise<T>, deps: DependencyList, cacheKey?: string) {
  const state = useAsync(fn, deps, cacheKey);
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

/** True when the device reports no internet connection. */
export function useOffline() {
  const network = useNetworkState();
  return network.isConnected === false || network.isInternetReachable === false;
}

/**
 * Subscribes to Postgres changes for a table (Supabase Realtime, RLS-filtered)
 * and calls `onChange` for each event.
 */
export function useRealtime(
  table: string,
  filter: string | undefined,
  onChange: (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void,
  enabled = true,
) {
  const supabase = useSupabase();
  // Always call the latest callback, so handlers see current state (not the first render's).
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`${table}:${filter ?? 'all'}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, (payload) =>
        handler.current(payload as unknown as { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, table, filter, enabled]);
}
