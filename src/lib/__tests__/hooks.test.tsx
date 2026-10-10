import { act, renderHook, waitFor } from '@testing-library/react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAsyncCache, freshMs, loadCacheFor, useAsync } from '../hooks';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: true }) }));
jest.mock('../supabase', () => ({ useSupabase: jest.fn() }));

describe('useAsync cache', () => {
  beforeEach(() => clearAsyncCache());

  it('reopening a screen within 30 s shows saved data without asking the server again', async () => {
    const fn = jest.fn(async () => 'rooms');
    const first = await renderHook(() => useAsync(fn, [], 'home'));
    await waitFor(() => expect(first.result.current.data).toBe('rooms'));
    await first.unmount();

    const second = await renderHook(() => useAsync(fn, [], 'home'));
    expect(second.result.current.data).toBe('rooms');
    expect(second.result.current.loading).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('pull-to-refresh (reload) always fetches', async () => {
    const fn = jest.fn(async () => 'rooms');
    const { result } = await renderHook(() => useAsync(fn, [], 'home'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.reload());
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });

  it('a new account never sees the old one\'s cached data', async () => {
    const fn = jest.fn(async () => 'mine');
    const a = await renderHook(() => useAsync(fn, [], 'wallet'));
    await waitFor(() => expect(a.result.current.data).toBe('mine'));
    await a.unmount();
    clearAsyncCache();
    const b = await renderHook(() => useAsync(async () => 'theirs', [], 'wallet'));
    expect(b.result.current.data).not.toBe('mine');
    await waitFor(() => expect(b.result.current.data).toBe('theirs'));
  });
});

describe('saved cache on the phone', () => {
  beforeEach(async () => {
    await loadCacheFor(null);
    await AsyncStorage.clear();
  });

  it('a cold start shows the last screen at once (Sets and Maps intact)', async () => {
    await loadCacheFor('user_a');
    const feed = { rooms: ['r1'], followed: new Set(['h1']), recs: new Map([['r1', { score: 2 }]]) };
    const first = await renderHook(() => useAsync(async () => feed, [], 'home'));
    await waitFor(() => expect(first.result.current.data).toBe(feed));
    await first.unmount();
    await waitFor(async () => expect(await AsyncStorage.getItem('zl-cache:v1:user_a')).not.toBeNull(), { timeout: 3000 });

    // App closed and reopened a minute later (memory gone), same account.
    const realNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
    await loadCacheFor('someone_else');
    await loadCacheFor('user_a');
    const never = jest.fn(() => new Promise<typeof feed>(() => {}));
    const second = await renderHook(() => useAsync(never, [], 'home'));
    const shown = second.result.current.data as typeof feed;
    expect(shown.rooms).toEqual(['r1']);
    expect(shown.followed.has('h1')).toBe(true);
    expect(shown.recs.get('r1')).toEqual({ score: 2 });
    // Saved data is older than 30 s, so the screen still asks the server for fresh data.
    expect(never).toHaveBeenCalled();
    clock.mockRestore();
  });

  it('another account never sees saved screens, and signing out deletes them', async () => {
    await loadCacheFor('user_a');
    const a = await renderHook(() => useAsync(async () => 'a-wallet', [], 'wallet'));
    await waitFor(() => expect(a.result.current.data).toBe('a-wallet'));
    await a.unmount();
    await waitFor(async () => expect(await AsyncStorage.getItem('zl-cache:v1:user_a')).not.toBeNull(), { timeout: 3000 });

    await loadCacheFor('user_b');
    const b = await renderHook(() => useAsync(() => new Promise<string>(() => {}), [], 'wallet'));
    expect(b.result.current.data).toBeUndefined();
    await b.unmount();

    await loadCacheFor('user_a');
    await loadCacheFor(null);
    expect(await AsyncStorage.getItem('zl-cache:v1:user_a')).toBeNull();
  });

  it('catalogs stay fresh for 10 minutes, screens for 30 s', () => {
    expect(freshMs('gift-catalog')).toBe(600_000);
    expect(freshMs('wallet')).toBe(30_000);
  });
});

