import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { liveColors, useTheme } from '../theme';

describe('useTheme', () => {
  it('is always the white theme, whatever the phone setting', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.c.background).toBe('#FFFFFF');
    expect(result.current.c.primary).toBe('#6A1FE0');
  });

  it('keeps live video screens dark', () => {
    expect(liveColors.background).toBe('#000000');
    expect(liveColors.primary).toBe('#B488FF');
  });

  it('blends actions from the icon purple into pink, with white text', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient).toEqual(['#6A1FE0', '#9B2FE0', '#D62872']);
    expect(result.current.c.primaryText).toBe('#FFFFFF');
  });

  it('uses the same red LIVE tag on white and on video', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.live).toBe(liveColors.live);
  });
});
