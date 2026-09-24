import { useColorScheme } from 'react-native';

// Design tokens (architecture §09). Original Zynalive identity: violet + coral.
export const spacing = { 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64 } as const;
export const radius = { 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, pill: 999 } as const;

export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  bodyLarge: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodySmall: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '700', letterSpacing: 0.3 },
} as const;

export type TypeVariant = keyof typeof type;

const light = {
  background: '#F7F6FB',
  surface: '#FFFFFF',
  surfaceRaised: '#F0EEF8',
  border: '#E3E0EF',
  text: '#16131F',
  textMuted: '#6B6680',
  primary: '#7C5CFF',
  primaryText: '#FFFFFF',
  accent: '#FF6B57',
  live: '#FF3B5C',
  success: '#1FA971',
  warning: '#D9A441',
  danger: '#D9363E',
  overlay: 'rgba(0,0,0,0.45)',
};

const dark: typeof light = {
  background: '#0E0C14',
  surface: '#17141F',
  surfaceRaised: '#211D2C',
  border: '#2E2939',
  text: '#F4F2FA',
  textMuted: '#9C96AE',
  primary: '#8D71FF',
  primaryText: '#FFFFFF',
  accent: '#FF7A68',
  live: '#FF4D6A',
  success: '#34C789',
  warning: '#E5B652',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.55)',
};

export type Palette = typeof light;

export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === 'light' ? light : dark;
  return { c, scheme: scheme === 'light' ? 'light' : 'dark', spacing, radius, type } as const;
}

// Live video screens are always dark regardless of system theme.
export const liveColors = dark;
