import { useWindowDimensions, useColorScheme } from 'react-native';

// Design tokens — Zynalive canvas (red live accent, gold coins, violet earnings;
// Bricolage Grotesque display over DM Sans body).
export const spacing = { 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64 } as const;
export const radius = { 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, pill: 999 } as const;

/**
 * Width breakpoints (dp), so layout adapts across compact phones (iPhone SE,
 * small Android) through extra-large ones (Pro Max, foldables unfolded) —
 * never hard-coded against one device size. Ranges match the design lock.
 */
export type Breakpoint = 'compact' | 'standard' | 'large' | 'xlarge';
export function breakpointFor(width: number): Breakpoint {
  if (width < 360) return 'compact';
  if (width < 400) return 'standard';
  if (width < 480) return 'large';
  return 'xlarge';
}
/** Current width breakpoint, from live window width (rotation/foldable-safe). */
export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return breakpointFor(width);
}
/** Screen-edge horizontal padding per breakpoint — never lets content touch the edge, never over-pads a small phone. */
const H_PADDING: Record<Breakpoint, number> = { compact: spacing[12], standard: spacing[16], large: spacing[16], xlarge: spacing[24] };
export function useHPadding(): number {
  return H_PADDING[useBreakpoint()];
}

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

// Purple/pink rebrand (was white/blue). Gold stays as the coin/gift color only —
// that's a semantic "currency" cue used industry-wide (BIGO, TikTok, etc.),
// not the app's brand color, so it doesn't change with this rebrand.
type Gradient = readonly [string, string, string];
const dark = {
  background: '#170B2E',
  surface: '#241442',
  surfaceRaised: '#2E1B54',
  border: '#3A2569',
  divider: '#2A1849',
  tabBar: '#140A26',
  text: '#F7F1FF',
  textMuted: '#C9B8E8',
  textFaint: '#8F7AB8',
  primary: '#B341E0',
  primaryText: '#FFFFFF',
  accent: '#FF5FA2',
  live: '#B341E0',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#2A2110',
  goldBorder: '#4A3A18',
  goldText: '#FFE3A3',
  violet: '#8B5CF6',
  violetSurface: '#241542',
  violetBorder: '#3D2A66',
  violetText: '#E7DBFF',
  success: '#34C789',
  warning: '#FFC24B',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.6)',
  // HDR-style gradient + glow tokens for hero surfaces (buttons, live badge,
  // balance cards, auth hero) — see GradientCard/GlowButton in ui.tsx.
  gradient: ['#5B2A9E', '#B341E0', '#FF6FB0'] as Gradient,
  glow: 'rgba(179,65,224,0.55)',
};

const light: typeof dark = {
  background: '#FDF3FA',
  surface: '#FFFFFF',
  surfaceRaised: '#F6E9FB',
  border: '#EAD3F2',
  divider: '#F1E0F6',
  tabBar: '#FFFFFF',
  text: '#241033',
  textMuted: '#6B5285',
  textFaint: '#8C76A6',
  primary: '#9333EA',
  primaryText: '#FFFFFF',
  accent: '#EC4899',
  live: '#9333EA',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#FFF4DA',
  goldBorder: '#F1D38A',
  goldText: '#6B4A00',
  violet: '#8B5CF6',
  violetSurface: '#F1EBFF',
  violetBorder: '#DCCCFB',
  violetText: '#5B2A9E',
  success: '#1FA971',
  warning: '#B7791F',
  danger: '#D9363E',
  overlay: 'rgba(0,0,0,0.45)',
  gradient: ['#F6D9EE', '#B341E0', '#5B2A9E'] as Gradient,
  glow: 'rgba(147,51,234,0.35)',
};

export type Palette = typeof dark;

export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === 'light' ? light : dark;
  const breakpoint = useBreakpoint();
  return { c, scheme: scheme === 'light' ? 'light' : 'dark', spacing, radius, type, breakpoint, hPadding: H_PADDING[breakpoint] } as const;
}

// Live video screens are always dark regardless of system theme.
export const liveColors = dark;
