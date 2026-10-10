import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

import { useSupabase } from './supabase';

type AsyncState<T> = { data: T | undefined; error: Error | null; loading: boolean; reload: () => void };

// Last result per cacheKey for the signed-in account. Kept in memory and saved on the phone
// (per account) so a cold start shows the last screens at once while fresh data loads; cleared
// when the account changes and deleted from the phone on sign-out.
const cache = new Map<string, { data: unknown; at: number }>();

/** Results younger than this are shown without asking the server again (realtime keeps them current). */
export const FRESH_MS = 30_000;
/** Catalogs that rarely change stay fresh longer. */
const LONG_FRESH: Record<string, number> = { 'gift-catalog': 10 * 60_000, 'frame-catalog': 10 * 60_000 };
export function freshMs(cacheKey?: string) {
  return (cacheKey && LONG_FRESH[cacheKey]) || FRESH_MS;
}

/** Forget every cached screen (call when the signed-in account changes). */
export function clearAsyncCache() {
  cache.clear();
}

// Saved copy on the phone -----------------------------------------------------------------------
const STORE_PREFIX = 'zl-cache:v1:';
/** Saved screens older than this are dropped on start (yesterday's live rooms aren't worth showing). */
const MAX_SAVED_AGE_MS = 12 * 60 * 60_000;
/** Upper bound on what is written to the phone. */
const MAX_SAVED_CHARS = 300_000;
let owner: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Screens keep Sets and Maps (e.g. who you follow); JSON alone would turn them into {}.
function replacer(_k: string, v: unknown) {
  if (v instanceof Set) return { __zl: 'Set', v: [...v] };
  if (v instanceof Map) return { __zl: 'Map', v: [...v] };
  return v;
}
function reviver(_k: string, v: unknown) {
  if (v && typeof v === 'object' && '__zl' in v) {
    const t = v as { __zl: string; v: unknown[] };
    if (t.__zl === 'Set') return new Set(t.v);
    if (t.__zl === 'Map') return new Map(t.v as [unknown, unknown][]);
  }
  return v;
}

/**
 * Makes the cache belong to `userId`: on a change, forgets the old account's screens (and on
 * sign-out deletes them from the phone), then loads this account's saved screens. Resolves once
 * they are in memory, so the first screen can open with them.
 */
export async function loadCacheFor(userId: string | null): Promise<void> {
  if (owner === userId) return;
  const previous = owner;
  owner = userId;
  cache.clear();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    if (!userId) {
      if (previous) await AsyncStorage.removeItem(STORE_PREFIX + previous);
      return;
    }
    const raw = await AsyncStorage.getItem(STORE_PREFIX + userId);
    if (!raw || owner !== userId) return;
    const saved = JSON.parse(raw, reviver) as Record<string, { data: unknown; at: number }>;
    const now = Date.now();
    for (const [k, v] of Object.entries(saved)) {
      if (v && typeof v.at === 'number' && now - v.at < MAX_SAVED_AGE_MS && !cache.has(k)) cache.set(k, v);
    }
  } catch {
    // A broken or unreadable saved copy just means a normal (network) start.
  }
}

/** Writes this account's screens to the phone shortly after they change (newest first, capped). */
function scheduleSave() {
  if (!owner || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const forUser = owner;
    if (!forUser) return;
    const out: Record<string, { data: unknown; at: number }> = {};
    let size = 2;
    for (const [k, v] of [...cache.entries()].sort((a, b) => b[1].at - a[1].at)) {
      let json: string;
      try {
        json = JSON.stringify(v, replacer);
      } catch {
        continue;
      }
      if (size + json.length > MAX_SAVED_CHARS) continue;
      size += json.length + k.length + 4;
      out[k] = v;
    }
    void AsyncStorage.setItem(STORE_PREFIX + forUser, JSON.stringify(out, replacer)).catch(() => {});
  }, 800);
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
    const fresh = !!hit && Date.now() - hit.at < freshMs(cacheKey);
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
      const fresh = Date.now() - hit.at < freshMs(cacheKey);
      void Promise.resolve().then(() => {
        if (!cancelled) setState((prev) => ({ key: fresh ? key : prev.key, data: hit.data as T, error: null, at: hit.at }));
      });
      if (fresh) return () => { cancelled = true; };
    }
    fn().then(
      (data) => {
        if (cancelled) return;
        const at = Date.now();
        if (cacheKey) {
          cache.set(cacheKey, { data, at });
          scheduleSave();
        }
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
      else if (Date.now() - lastLoaded.current >= freshMs(cacheKey)) reload();
    }, [focusedOnce, reload, cacheKey]),
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
