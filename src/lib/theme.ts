import { useWindowDimensions } from 'react-native';

import { brand, type Brand, type ThemePreset } from './brand';

// Design tokens. Colours come from the brand's theme preset (brands/<id>/brand.json); red LIVE
// tags and gold coins are shared by every brand.
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

// Glass & sky (the default preset): a soft sky-blue background, frosted white cards, dark navy
// text and deep-blue pill buttons. Live video screens use the night version: deep navy, with light
// sky-blue actions and near-black text on them. Every text colour meets 4.5:1 on its background;
// white on the button gradient is 5:1 or better across the whole blend.
type Gradient = readonly [string, string, string];
const dark = {
  background: '#061826',
  surface: '#0C2338',
  surfaceRaised: '#12304A',
  border: '#1E4566',
  divider: '#0F2A40',
  tabBar: '#071B2B',
  text: '#FFFFFF',
  textMuted: '#B9CCDD',
  textFaint: '#89A3BA',
  primary: '#7DD3FC',
  primaryText: '#04121F',
  accent: '#67E8F9',
  live: '#E11D48',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#241C0C',
  goldBorder: '#4A3A18',
  goldText: '#FFE3A3',
  violet: '#7DD3FC',
  violetSurface: '#0C2A44',
  violetBorder: '#1E4D70',
  violetText: '#D6F0FF',
  success: '#34C789',
  warning: '#FFC24B',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.7)',
  gradient: ['#38BDF8', '#5CC8FA', '#7DD3FC'] as Gradient,
  glow: 'rgba(125,211,252,0.35)',
  /** Screen background, top to bottom. */
  sky: ['#0C4A6E', '#082F49', '#061826'] as Gradient,
};

// `surface` is frosted white over the sky; `surfaceRaised` is solid white (inputs, sheets).
// The "violet" names are kept for the brand-tint family so existing screens don't change.
const light: typeof dark = {
  background: '#E6F4FD',
  surface: 'rgba(255,255,255,0.72)',
  surfaceRaised: '#FFFFFF',
  border: '#CFE6F5',
  divider: '#DCEEF9',
  tabBar: '#FFFFFF',
  text: '#0C2340',
  textMuted: '#3B5573',
  textFaint: '#48627E',
  primary: '#0369A1',
  primaryText: '#FFFFFF',
  accent: '#0E7490',
  live: '#E11D48',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#FFF5DD',
  goldBorder: '#F2D58E',
  goldText: '#8A5A00',
  violet: '#0369A1',
  violetSurface: '#F0F9FF',
  violetBorder: '#BAE6FD',
  violetText: '#075985',
  success: '#16875A',
  warning: '#9A6200',
  danger: '#C8323A',
  overlay: 'rgba(12,35,64,0.45)',
  gradient: ['#075985', '#0369A1', '#0279BB'] as Gradient,
  glow: 'rgba(3,105,161,0.28)',
  sky: ['#BAE6FD', '#E0F2FE', '#F0F9FF'] as Gradient,
};

export type Palette = typeof dark;

const PRESETS: Record<ThemePreset, { light: Palette; dark: Palette }> = { 'glass-sky': { light, dark } };

/** Mixes a #RRGGBB colour toward black (amount < 0) or white (amount > 0). */
function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const mix = (v: number) => Math.round(v + (target - v) * Math.abs(amount)).toString(16).padStart(2, '0');
  return `#${mix(n >> 16)}${mix((n >> 8) & 255)}${mix(n & 255)}`.toUpperCase();
}

/** A brand's own main colour replaces the preset's primary family; everything else stays. */
export function brandPalettes(theme: Brand['theme']): { light: Palette; dark: Palette } {
  const base = PRESETS[theme.preset] ?? PRESETS['glass-sky'];
  const p = theme.primary;
  if (!p || !/^#[0-9A-Fa-f]{6}$/.test(p)) return base;
  const night = shade(p, 0.55);
  return {
    light: { ...base.light, primary: p, violet: p, violetText: shade(p, -0.3), violetBorder: shade(p, 0.7), violetSurface: shade(p, 0.93), gradient: [shade(p, -0.2), p, shade(p, 0.12)], glow: `${p}47` },
    dark: { ...base.dark, primary: night, violet: night, accent: night, gradient: [shade(p, 0.35), shade(p, 0.45), night], glow: `${night}59` },
  };
}

const palettes = brandPalettes(brand.theme);

/** The app always uses the brand's light look, whatever the phone setting. */
export function useTheme() {
  const breakpoint = useBreakpoint();
  return { c: palettes.light, scheme: 'light', spacing, radius, type, breakpoint, hPadding: H_PADDING[breakpoint] } as const;
}

// Live video screens (live rooms, party rooms, going live, PK battles) stay dark.
export const liveColors = palettes.dark;
