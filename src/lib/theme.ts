import { useWindowDimensions } from 'react-native';

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

// Black + light sky blue brand. The whole app is dark (black), with light sky blue for actions,
// highlights and the live badge. Filled sky surfaces carry near-black text (primaryText): white on
// light sky is unreadable. Gold stays the coin/gift colour (an industry-wide "currency" cue).
type Gradient = readonly [string, string, string];
const dark = {
  background: '#000000',
  surface: '#111316',
  surfaceRaised: '#1A1D22',
  border: '#2A2F37',
  divider: '#1C2026',
  tabBar: '#0B0C0E',
  text: '#FFFFFF',
  textMuted: '#B3BDC9',
  textFaint: '#7D8896',
  primary: '#87CEFA',
  primaryText: '#00131F',
  accent: '#B5E4FC',
  live: '#87CEFA',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#241C0C',
  goldBorder: '#4A3A18',
  goldText: '#FFE3A3',
  violet: '#87CEFA',
  violetSurface: '#0A1A23',
  violetBorder: '#1C3A4A',
  violetText: '#CDEEFE',
  success: '#34C789',
  warning: '#FFC24B',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.7)',
  // Light sky gradient for hero surfaces (buttons, live badge, headers); text on it is primaryText.
  gradient: ['#5AC8FA', '#87CEFA', '#B5E4FC'] as Gradient,
  glow: 'rgba(135,206,250,0.45)',
};

// The app has one look now; `light` is kept as an alias so older imports keep working.
const light: typeof dark = dark;

export type Palette = typeof dark;

/** The app is always black with light sky blue accents, whatever the phone's setting. */
export function useTheme() {
  const breakpoint = useBreakpoint();
  return { c: light, scheme: 'dark', spacing, radius, type, breakpoint, hPadding: H_PADDING[breakpoint] } as const;
}

// Live video screens use the same black palette.
export const liveColors = dark;
