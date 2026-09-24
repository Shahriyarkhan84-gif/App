import { useColorScheme } from 'react-native';

// Design tokens — Zynalive canvas (red live accent, gold coins, violet earnings;
// Bricolage Grotesque display over DM Sans body).
export const spacing = { 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64 } as const;
export const radius = { 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, pill: 999 } as const;

/** Font family names registered in the root layout (`useFonts`). */
export const fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
} as const;

export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', fontFamily: fonts.display, letterSpacing: -0.5 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '800', fontFamily: fonts.display },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontFamily: fonts.display },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  bodyLarge: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodySmall: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
} as const;

export type TypeVariant = keyof typeof type;

/** Maps a numeric/keyword weight to the loaded DM Sans face. */
export function bodyFont(weight?: string | number | null) {
  const w = weight === 'bold' ? 700 : Number(weight ?? 400) || 400;
  return w >= 600 ? fonts.bold : w >= 500 ? fonts.medium : fonts.regular;
}

const dark = {
  background: '#0E0D12',
  surface: '#17151E',
  surfaceRaised: '#1C1A24',
  border: '#2C2937',
  divider: '#26232F',
  tabBar: '#15131B',
  text: '#F4F1F8',
  textMuted: '#B9B3C6',
  textFaint: '#8C8699',
  primary: '#D81E45',
  primaryText: '#FFFFFF',
  accent: '#FFC24B',
  live: '#D81E45',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#2A2110',
  goldBorder: '#4A3A18',
  goldText: '#FFE3A3',
  violet: '#6D4AE0',
  violetSurface: '#1B1830',
  violetBorder: '#2F2A52',
  violetText: '#E6E1FF',
  success: '#34C789',
  warning: '#FFC24B',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.6)',
};

const light: typeof dark = {
  background: '#F7F5FA',
  surface: '#FFFFFF',
  surfaceRaised: '#F0EDF4',
  border: '#E2DDE9',
  divider: '#ECE8F1',
  tabBar: '#FFFFFF',
  text: '#16131F',
  textMuted: '#5E5870',
  textFaint: '#716B80',
  primary: '#C81A3F',
  primaryText: '#FFFFFF',
  accent: '#B7791F',
  live: '#D81E45',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#FFF4DA',
  goldBorder: '#F1D38A',
  goldText: '#6B4A00',
  violet: '#6D4AE0',
  violetSurface: '#EEEBFF',
  violetBorder: '#D6CFFF',
  violetText: '#3A2A8A',
  success: '#1FA971',
  warning: '#B7791F',
  danger: '#D9363E',
  overlay: 'rgba(0,0,0,0.45)',
};

export type Palette = typeof dark;

export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === 'light' ? light : dark;
  return { c, scheme: scheme === 'light' ? 'light' : 'dark', spacing, radius, type } as const;
}

// Live video screens are always dark regardless of system theme.
export const liveColors = dark;
