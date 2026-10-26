import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { brand, hasFeature, U, units } from '../brand';
import { appIsDark, brandPalettes, liveColors, useTheme } from '../theme';

const PINK = ['#F48FB8', '#D62872', '#FF7AA2', '#C98CF5', '#9B2FE0'];

describe('useTheme', () => {
  it('is always the brand look (Glass & sky, light), whatever the phone setting', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(appIsDark).toBe(false);
    expect(result.current.c.sky).toEqual(['#BAE6FD', '#E0F2FE', '#F0F9FF']);
    expect(result.current.c.primary).toBe('#0369A1');
  });

  it('uses deep-blue buttons with white text', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient).toEqual(['#075985', '#0369A1', '#0279BB']);
    expect(result.current.c.primaryText).toBe('#FFFFFF');
  });

  it('keeps live video screens dark navy, with the same red LIVE tag', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(liveColors.background).toBe('#061826');
    expect(result.current.c.live).toBe(liveColors.live);
  });

  it('has no pink in any preset', () => {
    for (const preset of ['glass-sky', 'midnight'] as const) {
      const { light, dark } = brandPalettes({ preset });
      const colours = JSON.stringify([light, dark]).toUpperCase();
      for (const pink of PINK) expect(colours).not.toContain(pink);
    }
  });
});

describe('brand', () => {
  it('defaults to Zynalive on the Glass & sky preset, with videos switched off', () => {
    expect(brand.name).toBe('Zynalive');
    expect(brand.theme.preset).toBe('glass-sky');
    expect(hasFeature('partyRooms')).toBe(true);
    expect(hasFeature('pkBattles')).toBe(true);
    expect(hasFeature('videos')).toBe(false);
  });

  it('keeps Midnight available as a dark preset for other brands', () => {
    const night = brandPalettes({ preset: 'midnight' });
    expect(night.appearance).toBe('dark');
    expect(night.light.background).toBe('#0E0E10');
    expect(night.light.primary).toBe('#A78BFA');
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

  it('lightens a client colour on a dark preset so text on it stays readable', () => {
    const custom = brandPalettes({ preset: 'midnight', primary: '#2563EB' });
    expect(custom.light.background).toBe('#0E0E10');
    expect(custom.light.primary).not.toBe('#2563EB');
    expect(custom.light.primaryText).toBe('#140A2E');
  });

  it('ignores an invalid colour', () => {
    expect(brandPalettes({ preset: 'glass-sky', primary: 'red' }).light.primary).toBe('#0369A1');
  });
});

describe('unit names', () => {
  it('calls the bought unit diamonds and the earned unit beans for Zynalive', () => {
    expect(U.Spend).toBe('Diamonds');
    expect(U.earn).toBe('beans');
    expect(units(1)).toBe('1 diamond');
    expect(units(1250)).toBe('1,250 diamonds');
    expect(units(2, 'earn')).toBe('2 beans');
  });
});
