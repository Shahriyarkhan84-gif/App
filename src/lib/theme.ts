import { useWindowDimensions } from 'react-native';

// Design tokens — the look of a live-streaming app (Bigo/Tango/Chamet family): white screens, the
// purple of the Zynalive icon blending into pink for actions, red LIVE tags, gold for coins.
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

// Live video screens stay dark (video reads best on black). On black, actions use a light purple
// to pink blend with near-black text; the LIVE tag is the same red as on white.
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
  accent: '#F48FB8',
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
  gradient: ['#B488FF', '#C98CF5', '#F48FB8'] as Gradient,
  glow: 'rgba(180,136,255,0.35)',
};

// The rest of the app is white. Actions are a purple-to-pink gradient (white text reads at 4.8:1 or
// better across the whole blend); purple alone is the accent for links, icons and selected states.
// Every text colour here meets 4.5:1 on its background.
const light: typeof dark = {
  background: '#FFFFFF',
  surface: '#F6F3FA',
  surfaceRaised: '#FFFFFF',
  border: '#E6E0EF',
  divider: '#F0ECF5',
  tabBar: '#FFFFFF',
  text: '#16121F',
  textMuted: '#5A5368',
  textFaint: '#736C82',
  primary: '#6A1FE0',
  primaryText: '#FFFFFF',
  accent: '#D62872',
  live: '#E11D48',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#FFF5DD',
  goldBorder: '#F2D58E',
  goldText: '#8A5A00',
  violet: '#6A1FE0',
  violetSurface: '#F2EBFF',
  violetBorder: '#DCCBFF',
  violetText: '#4A1A9E',
  success: '#16875A',
  warning: '#9A6200',
  danger: '#C8323A',
  overlay: 'rgba(22,18,31,0.5)',
  gradient: ['#6A1FE0', '#9B2FE0', '#D62872'] as Gradient,
  glow: 'rgba(106,31,224,0.28)',
};

export type Palette = typeof dark;

/** The app is always white with purple-to-pink accents, whatever the phone's setting. */
export function useTheme() {
  const breakpoint = useBreakpoint();
  return { c: light, scheme: 'light', spacing, radius, type, breakpoint, hPadding: H_PADDING[breakpoint] } as const;
}

// Live video screens (live rooms, party rooms, going live, PK battles) stay dark.
export const liveColors = dark;
