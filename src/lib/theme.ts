import { useWindowDimensions } from 'react-native';

// Design tokens — the look of a live-streaming app (Bigo/Tango/Chamet family): dark screens, the
// violet of the Zynalive icon for actions, red LIVE tags, gold for coins. No pink anywhere.
// Chunky Bricolage Grotesque for big headings and the wordmark, DM Sans for everything else.
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
  /** The brand face: the wordmark and the two biggest heading sizes (display, h1). */
  brand: 'BricolageGrotesque_800ExtraBold',
  display: 'DMSans_700Bold',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
} as const;

export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '800', fontFamily: fonts.brand, letterSpacing: -0.5 },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '800', fontFamily: fonts.brand, letterSpacing: -0.3 },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '700', fontFamily: fonts.display, letterSpacing: -0.3 },
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

// The whole app is dark (video reads best on black). Actions use a light violet blend with
// near-black text; the LIVE tag is the same red everywhere.
type Gradient = readonly [string, string, string];
const dark = {
  background: '#000000',
  surface: '#131118',
  surfaceRaised: '#1C1924',
  border: '#2E2A38',
  divider: '#1F1C27',
  tabBar: '#0C0B10',
  text: '#FFFFFF',
  textMuted: '#BDB6CC',
  textFaint: '#8A8399',
  primary: '#B488FF',
  primaryText: '#1A0633',
  accent: '#B488FF',
  live: '#E11D48',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#241C0C',
  goldBorder: '#4A3A18',
  goldText: '#FFE3A3',
  violet: '#B488FF',
  violetSurface: '#1A1230',
  violetBorder: '#3A2A60',
  violetText: '#E2D2FF',
  success: '#34C789',
  warning: '#FFC24B',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.7)',
  gradient: ['#B488FF', '#A57AF7', '#9B6CF0'] as Gradient,
  glow: 'rgba(180,136,255,0.35)',
};

export type Palette = typeof dark;

/** The app is always dark with violet accents, whatever the phone's setting. */
export function useTheme() {
  const breakpoint = useBreakpoint();
  return { c: dark, scheme: 'dark', spacing, radius, type, breakpoint, hPadding: H_PADDING[breakpoint] } as const;
}

// Live video screens (live rooms, party rooms, going live, PK battles) use the same dark palette.
export const liveColors = dark;
