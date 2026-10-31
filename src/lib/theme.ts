import { useWindowDimensions } from 'react-native';

import { brand, type Brand, type ThemePreset } from './brand';

// Design tokens. Colours come from the brand's theme preset (brands/<id>/brand.json); red LIVE
// tags and gold coins are shared by every brand. No preset uses pink.
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
  /** Edge of a frosted card. */
  glassBorder: '#1E4566',
  /** Glass kit (Figma "App glass kit"): frosted fill, top-down sheen and bright hairline edge. */
  glassFill: 'rgba(255,255,255,0.06)',
  glassSheen: ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0)'] as Gradient,
  glassEdge: 'rgba(255,255,255,0.16)',
  /** Selected chips, tabs and toggles. */
  accentGradient: ['#38BDF8', '#5CC8FA', '#7DD3FC'] as Gradient,
  goldGradient: ['#FFD877', '#FFC24B', '#F5A524'] as Gradient,
  dangerGradient: ['#F43F5E', '#E11D48', '#BE123C'] as Gradient,
  /** Aurora glows over the screen background (top-left, right, bottom); null on presets without them. */
  aurora: null as Gradient | null,
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
  glassBorder: 'rgba(255,255,255,0.9)',
  glassFill: 'rgba(255,255,255,0.58)',
  glassSheen: ['rgba(255,255,255,0.65)', 'rgba(255,255,255,0.08)', 'rgba(224,242,254,0.12)'] as Gradient,
  glassEdge: 'rgba(255,255,255,0.95)',
  accentGradient: ['#075985', '#0369A1', '#0EA5E9'] as Gradient,
  goldGradient: ['#FFD877', '#FFC24B', '#F5A524'] as Gradient,
  dangerGradient: ['#F43F5E', '#E11D48', '#BE123C'] as Gradient,
  aurora: null,
};

export type Palette = typeof dark;

// Midnight: the whole app is dark, matching the Figma design — near-black screens, charcoal cards,
// white text, light-violet actions with near-black text on them (5:1 or better), gold coins, red
// LIVE. No pink. Live video screens use the same palette.
const midnight: Palette = {
  background: '#0E0E10',
  surface: '#1C1C20',
  surfaceRaised: '#26262B',
  border: '#33333A',
  divider: '#26262B',
  tabBar: '#121214',
  text: '#FFFFFF',
  textMuted: '#B8B8C2',
  textFaint: '#8C8C98',
  primary: '#A78BFA',
  primaryText: '#140A2E',
  accent: '#A78BFA',
  live: '#E11D48',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: '#241C0C',
  goldBorder: '#4A3A18',
  goldText: '#FFE3A3',
  violet: '#A78BFA',
  violetSurface: '#1E1633',
  violetBorder: '#3B2E66',
  violetText: '#E4DAFF',
  success: '#34C789',
  warning: '#FFC24B',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.7)',
  gradient: ['#B69CFB', '#A78BFA', '#9B7BF7'] as Gradient,
  glow: 'rgba(167,139,250,0.35)',
  sky: ['#16161A', '#111114', '#0E0E10'] as Gradient,
  glassBorder: '#2A2A30',
  glassFill: 'rgba(255,255,255,0.05)',
  glassSheen: ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)'] as Gradient,
  glassEdge: 'rgba(255,255,255,0.12)',
  accentGradient: ['#B69CFB', '#A78BFA', '#9B7BF7'] as Gradient,
  goldGradient: ['#FFD877', '#FFC24B', '#F5A524'] as Gradient,
  dangerGradient: ['#FF6B72', '#FF5A61', '#E11D48'] as Gradient,
  aurora: null,
};

// Aurora dark (Figma "Page options", option B): a deep night background lit by cyan, violet and
// teal glows, frosted glass cards with bright hairline edges, and cyan-to-violet actions with
// near-black text on them (6:1 or better across the blend). Live video screens use the same palette.
const aurora: Palette = {
  background: '#070B14',
  surface: 'rgba(255,255,255,0.07)',
  surfaceRaised: '#141D30',
  border: 'rgba(255,255,255,0.14)',
  divider: 'rgba(255,255,255,0.08)',
  tabBar: '#0B1220',
  text: '#FFFFFF',
  textMuted: '#B6C2D9',
  textFaint: '#8E9BB4',
  primary: '#67E8F9',
  primaryText: '#06121F',
  accent: '#67E8F9',
  live: '#E11D48',
  gold: '#FFC24B',
  onGold: '#2A1A00',
  goldSurface: 'rgba(255,194,75,0.12)',
  goldBorder: 'rgba(255,194,75,0.35)',
  goldText: '#FFE3A3',
  violet: '#A78BFA',
  violetSurface: 'rgba(167,139,250,0.14)',
  violetBorder: 'rgba(167,139,250,0.4)',
  violetText: '#E4DAFF',
  success: '#34C789',
  warning: '#FFC24B',
  danger: '#FF5A61',
  overlay: 'rgba(0,0,0,0.7)',
  gradient: ['#38BDF8', '#818CF8', '#A78BFA'] as Gradient,
  glow: 'rgba(103,232,249,0.35)',
  sky: ['#0B2A3C', '#0A1424', '#070B14'] as Gradient,
  glassBorder: 'rgba(255,255,255,0.14)',
  glassFill: 'rgba(255,255,255,0.06)',
  glassSheen: ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)'] as Gradient,
  glassEdge: 'rgba(255,255,255,0.16)',
  accentGradient: ['#38BDF8', '#818CF8', '#A78BFA'] as Gradient,
  goldGradient: ['#FFD877', '#FFC24B', '#F5A524'] as Gradient,
  dangerGradient: ['#FF6B72', '#FF5A61', '#E11D48'] as Gradient,
  aurora: ['rgba(34,211,238,0.30)', 'rgba(139,92,246,0.30)', 'rgba(20,184,166,0.24)'] as Gradient,
};

/** `light` is the palette for everyday screens, `dark` for live video; `appearance` says which one everyday screens look like. */
type Preset = { light: Palette; dark: Palette; appearance: 'light' | 'dark' };
const PRESETS: Record<ThemePreset, Preset> = {
  'glass-sky': { light, dark, appearance: 'light' },
  midnight: { light: midnight, dark: midnight, appearance: 'dark' },
  aurora: { light: aurora, dark: aurora, appearance: 'dark' },
};

/** Mixes a #RRGGBB colour toward black (amount < 0) or white (amount > 0). */
function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const mix = (v: number) => Math.round(v + (target - v) * Math.abs(amount)).toString(16).padStart(2, '0');
  return `#${mix(n >> 16)}${mix((n >> 8) & 255)}${mix(n & 255)}`.toUpperCase();
}

/** A brand's own main colour replaces the preset's primary family; everything else stays. */
export function brandPalettes(theme: Brand['theme']): Preset {
  const base = PRESETS[theme.preset] ?? PRESETS['glass-sky'];
  const p = theme.primary;
  if (!p || !/^#[0-9A-Fa-f]{6}$/.test(p)) return base;
  const night = shade(p, 0.55);
  // On a dark palette the brand colour is lightened so near-black text on it stays readable.
  const onDark = (pal: Palette): Palette => ({ ...pal, primary: night, violet: night, accent: night, gradient: [shade(p, 0.35), shade(p, 0.45), night], accentGradient: [shade(p, 0.35), shade(p, 0.45), night], glow: `${night}59` });
  return {
    appearance: base.appearance,
    light: base.appearance === 'dark'
      ? onDark(base.light)
      : { ...base.light, primary: p, violet: p, violetText: shade(p, -0.3), violetBorder: shade(p, 0.7), violetSurface: shade(p, 0.93), gradient: [shade(p, -0.2), p, shade(p, 0.12)], accentGradient: [shade(p, -0.2), p, shade(p, 0.2)], glow: `${p}47` },
    dark: onDark(base.dark),
  };
}

const palettes = brandPalettes(brand.theme);

/** The app always uses the brand preset's everyday look (light for Glass & sky, dark for Midnight), whatever the phone setting. */
export function useTheme() {
  const breakpoint = useBreakpoint();
  return { c: palettes.light, scheme: palettes.appearance, spacing, radius, type, breakpoint, hPadding: H_PADDING[breakpoint] } as const;
}

/** Whether everyday screens are dark, for the status bar and other native chrome. */
export const appIsDark = palettes.appearance === 'dark';

// Live video screens (live rooms, party rooms, going live, PK battles) are always dark.
export const liveColors = palettes.dark;
