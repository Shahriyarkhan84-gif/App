import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { brand, hasFeature } from '../brand';
import { appIsDark, brandPalettes, liveColors, useTheme } from '../theme';

const PINK = ['#F48FB8', '#D62872', '#FF7AA2', '#C98CF5', '#9B2FE0'];

describe('useTheme', () => {
  it('is always the brand look (Midnight, dark), whatever the phone setting', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
    expect(appIsDark).toBe(true);
    expect(result.current.c.background).toBe('#0E0E10');
    expect(result.current.c.primary).toBe('#A78BFA');
  });

  it('uses light-violet buttons with near-black text', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(result.current.c.gradient).toEqual(['#B69CFB', '#A78BFA', '#9B7BF7']);
    expect(result.current.c.primaryText).toBe('#140A2E');
  });

  it('keeps live video screens dark, with the same red LIVE tag', async () => {
    const { result } = await renderHook(() => useTheme());
    expect(liveColors.background).toBe('#0E0E10');
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
  it('defaults to Zynalive on the Midnight preset with every feature on', () => {
    expect(brand.name).toBe('Zynalive');
    expect(brand.theme.preset).toBe('midnight');
    expect(hasFeature('partyRooms')).toBe(true);
    expect(hasFeature('pkBattles')).toBe(true);
  });

  it('keeps Glass & sky available as a light preset', () => {
    const sky = brandPalettes({ preset: 'glass-sky' });
    expect(sky.appearance).toBe('light');
    expect(sky.light.primary).toBe('#0369A1');
    expect(sky.dark.background).toBe('#061826');
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
