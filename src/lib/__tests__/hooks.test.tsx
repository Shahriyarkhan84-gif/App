import { act, renderHook, waitFor } from '@testing-library/react-native';

import { clearAsyncCache, useAsync } from '../hooks';

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
