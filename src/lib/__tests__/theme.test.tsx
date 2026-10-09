import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { liveColors, useTheme } from '../theme';

describe('useTheme', () => {
  it('is always the black theme, whatever the phone setting', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
    expect(result.current.c.background).toBe('#000000');
    expect(result.current.c.primary).toBe('#87CEFA');
  });

  it('keeps live video screens dark', () => {
    expect(liveColors.background).toBe('#000000');
  });

  it('puts dark text on flat sky surfaces', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient.every((x) => x === '#87CEFA')).toBe(true);
    expect(result.current.c.glow).toBe('transparent');
    expect(result.current.c.primaryText).toBe('#00131F');
  });
});
