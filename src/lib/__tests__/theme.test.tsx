import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { liveColors, useTheme } from '../theme';

describe('useTheme', () => {
  it('is always the white theme, whatever the phone setting', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.c.background).toBe('#FFFFFF');
    expect(result.current.c.primary).toBe('#0277BD');
  });

  it('keeps live video screens dark', () => {
    expect(liveColors.background).toBe('#000000');
    expect(liveColors.primary).toBe('#87CEFA');
  });

  it('puts white text on flat sky blue surfaces', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient.every((x) => x === result.current.c.primary)).toBe(true);
    expect(result.current.c.glow).toBe('transparent');
    expect(result.current.c.primaryText).toBe('#FFFFFF');
  });
});
