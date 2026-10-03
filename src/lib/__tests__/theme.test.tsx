import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { liveColors, useTheme } from '../theme';

describe('useTheme', () => {
  it('is always the white theme, even when the phone is in dark mode', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.c.background).toBe('#FFFFFF');
  });

  it('keeps live video screens dark', () => {
    expect(liveColors.background).toBe('#170B2E');
  });

  it('uses a button gradient dark enough for white text (no pale first stop)', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient[0]).toBe('#5B2A9E');
  });
});
