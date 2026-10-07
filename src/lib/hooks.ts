import { useFocusEffect } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

import { useSupabase } from './supabase';

type AsyncState<T> = { data: T | undefined; error: Error | null; loading: boolean; reload: () => void };

// Last result per cacheKey, for this app session only (memory, cleared when the app closes or
// the signed-in account changes — see clearAsyncCache).
const cache = new Map<string, { data: unknown; at: number }>();

/** Results younger than this are shown without asking the server again (realtime keeps them current). */
export const FRESH_MS = 30_000;

/** Forget every cached screen (call when the signed-in account changes). */
export function clearAsyncCache() {
  cache.clear();
}

/**
 * Minimal data-fetching hook; re-runs when deps change or `reload` is called.
 * With a `cacheKey`, a screen opens showing its last result at once; if that result is under
 * FRESH_MS old it isn't fetched again at all, otherwise it refreshes in the background
 * (the server is far away, so a cold load takes a second or more).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, cacheKey?: string): AsyncState<T> & { loadedAt: number } {
  const [nonce, setNonce] = useState(0);
  // Identifies the current request; `loading` is true until a result for it lands.
  const key = JSON.stringify([...deps, nonce]);
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: Error | null; at: number }>(() => {
    const hit = cacheKey ? cache.get(cacheKey) : undefined;
    const fresh = !!hit && Date.now() - hit.at < FRESH_MS;
    // A fresh hit counts as already loaded for this request, so the effect below skips the fetch.
    return { key: fresh ? key : null, data: hit?.data as T | undefined, error: null, at: hit?.at ?? 0 };
  });
  const stateKey = useRef(state.key);
  const forceFetch = useRef(false);
  useEffect(() => {
    stateKey.current = state.key;
  }, [state.key]);

  useEffect(() => {
    if (stateKey.current === key) return; // fresh from cache
    let cancelled = false;
    // Switching to a request seen before (e.g. another Rankings tab): show it at once, and skip
    // the server entirely while it's fresh.
    const forced = forceFetch.current;
    forceFetch.current = false;
    const hit = cacheKey && !forced ? cache.get(cacheKey) : undefined;
    if (hit) {
      const fresh = Date.now() - hit.at < FRESH_MS;
      void Promise.resolve().then(() => {
        if (!cancelled) setState((prev) => ({ key: fresh ? key : prev.key, data: hit.data as T, error: null, at: hit.at }));
      });
      if (fresh) return () => { cancelled = true; };
    }
    fn().then(
      (data) => {
        if (cancelled) return;
        const at = Date.now();
        if (cacheKey) cache.set(cacheKey, { data, at });
        setState({ key, data, error: null, at });
      },
      (e: unknown) =>
        !cancelled && setState((prev) => ({ ...prev, key, error: e instanceof Error ? e : new Error(String(e)) })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // reload() (pull-to-refresh, realtime changes) always asks the server, never the cache.
  const reload = useCallback(() => {
    forceFetch.current = true;
    setNonce((n) => n + 1);
  }, []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload, loadedAt: state.at };
}

/**
 * Like useAsync, but refreshes when the screen regains focus — only if its data is older than
 * FRESH_MS, so switching tabs back and forth doesn't reload everything every time.
 */
export function useFocusedAsync<T>(fn: () => Promise<T>, deps: DependencyList, cacheKey?: string) {
  const state = useAsync(fn, deps, cacheKey);
  const { reload, loadedAt } = state;
  const lastLoaded = useRef(loadedAt);
  useEffect(() => {
    lastLoaded.current = loadedAt;
  }, [loadedAt]);
  const [focusedOnce, setFocusedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce) setFocusedOnce(true);
      else if (Date.now() - lastLoaded.current >= FRESH_MS) reload();
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
