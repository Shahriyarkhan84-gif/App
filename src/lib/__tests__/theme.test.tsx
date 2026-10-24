import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { brand, hasFeature } from '../brand';
import { brandPalettes, liveColors, useTheme } from '../theme';

describe('useTheme', () => {
  it('is always the brand light theme (Glass & sky), whatever the phone setting', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.c.sky).toEqual(['#BAE6FD', '#E0F2FE', '#F0F9FF']);
    expect(result.current.c.primary).toBe('#0369A1');
  });

  it('keeps live video screens dark navy', () => {
    expect(liveColors.background).toBe('#061826');
    expect(liveColors.primary).toBe('#7DD3FC');
  });

  it('uses deep-blue buttons with white text', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient).toEqual(['#075985', '#0369A1', '#0279BB']);
    expect(result.current.c.primaryText).toBe('#FFFFFF');
  });

  it('uses the same red LIVE tag on the sky and on video', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.live).toBe(liveColors.live);
  });
});

describe('brand', () => {
  it('defaults to Zynalive with every feature on', () => {
    expect(brand.name).toBe('Zynalive');
    expect(brand.theme.preset).toBe('glass-sky');
    expect(hasFeature('partyRooms')).toBe(true);
    expect(hasFeature('pkBattles')).toBe(true);
  });

  it("swaps in a client's own main colour and keeps the rest of the preset", () => {
    const base = brandPalettes({ preset: 'glass-sky' });
    const custom = brandPalettes({ preset: 'glass-sky', primary: '#E8344E' });
    expect(custom.light.primary).toBe('#E8344E');
    expect(custom.light.gradient[1]).toBe('#E8344E');
    expect(custom.light.sky).toEqual(base.light.sky);
    expect(custom.light.text).toBe(base.light.text);
    expect(custom.dark.background).toBe(base.dark.background);
  });

  it('ignores an invalid colour', () => {
    expect(brandPalettes({ preset: 'glass-sky', primary: 'red' }).light.primary).toBe('#0369A1');
  });
});
