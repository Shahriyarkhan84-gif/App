import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { liveColors, useTheme } from '../theme';

describe('useTheme', () => {
  it('is always the dark theme, whatever the phone setting', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
    expect(result.current.c.background).toBe('#000000');
    expect(result.current.c.primary).toBe('#B488FF');
  });

  it('keeps live video screens dark', () => {
    expect(liveColors.background).toBe('#000000');
    expect(liveColors.primary).toBe('#B488FF');
  });

  it('uses a violet-only action blend with dark text, and no pink', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient).toEqual(['#B488FF', '#A57AF7', '#9B6CF0']);
    expect(result.current.c.accent).toBe('#B488FF');
    expect(result.current.c.primaryText).toBe('#1A0633');
  });

  it('uses the same red LIVE tag on every screen and on video', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.live).toBe(liveColors.live);
  });
});
