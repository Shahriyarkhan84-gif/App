import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  Text as RNText,
  StyleSheet,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { brand } from '@/lib/brand';
import { bodyFont, fonts, liveColors, useTheme, type TypeVariant } from '@/lib/theme';

import { PressScale, Pulse } from './Motion';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Text({ variant = 'body', muted, faint, color, style, ...rest }: TextProps & { variant?: TypeVariant; muted?: boolean; faint?: boolean; color?: string }) {
  const { c, type } = useTheme();
  const base = type[variant] as TextStyle;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  // Custom fonts ship one file per weight: pick the face, and keep fontWeight
  // 'normal' so Android doesn't synthesise bold on top of it.
  const fontFamily = flat.fontFamily ?? base.fontFamily ?? bodyFont(flat.fontWeight ?? base.fontWeight);
  const loaded = fontFamily === fonts.brand || fontFamily.startsWith('DMSans');
  return (
    <RNText
      style={[base, { color: color ?? (faint ? c.textFaint : muted ? c.textMuted : c.text) }, style, { fontFamily, fontWeight: loaded ? 'normal' : flat.fontWeight }]}
      {...rest}
    />
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Text variant="display" accessibilityRole="header" accessibilityLabel={brand.name} style={{ fontFamily: fonts.brand, fontSize: size, lineHeight: size * 1.15, letterSpacing: 0 }}>
      {brand.wordmark[0]}<Text variant="display" color={c.primary} style={{ fontFamily: fonts.brand, fontSize: size, lineHeight: size * 1.15, letterSpacing: 0 }}>{brand.wordmark[1]}</Text>
    </Text>
  );
}

/** Full-screen page on the brand's sky background (Glass & sky: light blue fading to near white). */
export function Screen({ children, edges = ['top'], style }: { children: ReactNode; edges?: Edge[]; style?: StyleProp<ViewStyle> }) {
  return (
    <SkyBackground>
      <SafeAreaView edges={edges} style={[{ flex: 1 }, style]}>{children}</SafeAreaView>
    </SkyBackground>
  );
}

export function SkyBackground({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: c.background }, style]}>
      <LinearGradient colors={c.sky} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      {c.aurora && <AuroraGlows colors={c.aurora} />}
      {children}
    </View>
  );
}

/** Aurora dark: cyan light from the top left, violet from the right, teal rising from the bottom. */
function AuroraGlows({ colors: [cyan, violet, teal] }: { colors: readonly [string, string, string] }) {
  const clear = 'rgba(0,0,0,0)';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[cyan, clear]} start={{ x: 0, y: 0 }} end={{ x: 0.75, y: 0.45 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[violet, clear]} start={{ x: 1, y: 0.3 }} end={{ x: 0.35, y: 0.55 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[clear, teal]} start={{ x: 0.5, y: 0.6 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

/** Soft shadow under frosted cards. */
export const glassShadow: ViewStyle = { shadowColor: '#0C4A6E', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 2 };

// Glass kit (Figma page "App glass kit"): a frosted fill, a top-down sheen, a bright hairline edge
// and a soft sky shadow. Lists of cards use the sheen only (cheap); floating chrome (tab dock,
// sheets) also gets a real backdrop blur where the platform does it natively (iOS, web).

/** The top-down light that makes a surface read as glass. Put it first inside the surface. */
export function GlassSheen({ radius: r, colors }: { radius: number; colors?: readonly [string, string, string] }) {
  const { c } = useTheme();
  return <LinearGradient pointerEvents="none" colors={colors ?? c.glassSheen} locations={[0, 0.55, 1]} style={[StyleSheet.absoluteFill, { borderRadius: r }]} />;
}

/** Real backdrop blur on iOS and web; Android keeps the frosted tint (its blur needs every screen wrapped in a blur target). */
export function GlassBlur({ intensity = 40, tint = 'light' }: { intensity?: number; tint?: 'light' | 'dark' }) {
  if (Platform.OS === 'android') return null;
  return <BlurView pointerEvents="none" intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />;
}

const BUTTON_SHEEN = ['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0)'] as const;

type ButtonProps = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'outline';
  size?: 'md' | 'sm';
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, variant = 'primary', size = 'md', loading, icon, disabled, style, ...rest }: ButtonProps) {
  const { c, radius } = useTheme();
  const bg = { primary: c.primary, secondary: c.glassFill, ghost: 'transparent', danger: c.danger, gold: c.gold, outline: 'transparent' }[variant];
  const fill = variant === 'primary' ? c.gradient : variant === 'gold' ? c.goldGradient : variant === 'danger' ? c.dangerGradient : null;
  const fg = {
    primary: c.primaryText, danger: c.primaryText, gold: c.onGold, secondary: c.text, ghost: c.textMuted, outline: c.violetText,
  }[variant];
  const border = variant === 'secondary' ? c.glassEdge : variant === 'outline' ? c.violetBorder : 'transparent';
  const button = (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      haptic
      style={[
        {
          minHeight: size === 'md' ? 52 : 40,
          paddingHorizontal: size === 'md' ? 22 : 16,
          borderRadius: radius.pill,
          backgroundColor: fill ? 'transparent' : bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          borderWidth: border === 'transparent' ? 0 : 1,
          borderColor: border,
          opacity: disabled ? 0.45 : 1,
          overflow: 'hidden',
        },
        style,
      ]}
      {...rest}
    >
      {fill && <LinearGradient colors={fill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      {fill && <GlassSheen radius={radius.pill} colors={BUTTON_SHEEN} />}
      {variant === 'secondary' && <GlassSheen radius={radius.pill} />}
      {loading ? <ActivityIndicator color={fg} /> : icon}
      {!loading && <Text variant="label" color={fg} style={{ fontSize: size === 'md' ? 16 : 14 }}>{title}</Text>}
    </PressScale>
  );
  // Primary CTAs get an HDR-style glow — shadow goes on an outer wrapper since
  // overflow:hidden (needed to clip the gradient to the pill shape) would
  // otherwise clip the shadow too on iOS.
  if (variant !== 'primary' || disabled) return button;
  // The glow wrapper must take the button's own sizing (flex/width), or a flex:1 button in a row shrinks.
  const flat = StyleSheet.flatten(style) ?? {};
  const outer: ViewStyle = { flex: flat.flex, flexGrow: flat.flexGrow, flexShrink: flat.flexShrink, flexBasis: flat.flexBasis, width: flat.width, alignSelf: flat.alignSelf, minWidth: flat.minWidth };
  return <View style={[outer, { shadowColor: c.glow, shadowOpacity: 1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8, borderRadius: radius.pill }]}>{button}</View>;
}

/** Round 44pt icon-only button (header actions). */
/** `bg` overrides the surface (e.g. a translucent dark circle over live video). */
export function IconButton({ icon, label, onPress, color, badge, bg }: { icon: IconName; label: string; onPress?: () => void; color?: string; badge?: boolean; bg?: string }) {
  const { c } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.9}
      haptic
      style={[
        { width: 44, height: 44, borderRadius: 22, backgroundColor: bg ?? c.glassFill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: bg ? 'rgba(255,255,255,0.22)' : c.glassEdge },
        bg ? null : { shadowColor: '#0C4A6E', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      ]}
    >
      {!bg && <GlassSheen radius={22} />}
      <Ionicons name={icon} size={20} color={color ?? c.text} />
      {badge && <View style={{ position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: c.live, borderWidth: 1.5, borderColor: '#FFFFFF' }} />}
    </PressScale>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, radius } = useTheme();
  const r = (StyleSheet.flatten(style)?.borderRadius as number | undefined) ?? radius[24];
  return (
    <View style={[{ backgroundColor: c.glassFill, borderRadius: radius[24], borderWidth: 1, borderColor: c.glassEdge, padding: 16, gap: 8 }, glassShadow, style]}>
      <GlassSheen radius={r} />
      {children}
    </View>
  );
}

export function Avatar({ uri, name, size = 40, ring }: { uri?: string | null; name?: string | null; size?: number; ring?: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceRaised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        borderWidth: ring ? Math.max(2, Math.round(size / 26)) : 0, borderColor: ring,
      }}
    >
      {uri ? (
        <Image source={uri} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Text variant="display" style={{ fontSize: size * 0.4, lineHeight: size * 0.5 }}>{(name ?? '?').replace('@', '').slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const { c, radius } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      scaleTo={0.93}
      haptic
      style={{
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: radius.pill,
        backgroundColor: selected ? c.primary : c.glassFill,
        borderWidth: 1,
        borderColor: selected ? 'transparent' : c.glassEdge,
      }}
    >
      {selected
        ? <LinearGradient colors={c.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]} />
        : <GlassSheen radius={radius.pill} />}
      <Text variant="label" color={selected ? c.primaryText : c.textMuted} style={{ fontWeight: selected ? '700' : '500' }}>{label}</Text>
    </PressScale>
  );
}

/** Pill segmented control (filters, periods). */
export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  const { c, radius } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: radius.pill, backgroundColor: c.glassFill, borderWidth: 1, borderColor: c.glassEdge }}>
      <GlassSheen radius={radius.pill} />
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}
          >
            {on && <LinearGradient colors={c.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]} />}
            <Text variant="label" color={on ? c.primaryText : c.textMuted} style={{ fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Underlined text tabs (feed tabs, ranking boards). */
export function TextTabs<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 20 }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ paddingVertical: 10, minHeight: 44, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: on ? c.primary : 'transparent' }}
          >
            <Text variant="bodyLarge" color={on ? c.text : c.textFaint} style={{ fontWeight: on ? '700' : '500' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LiveBadge({ viewers }: { viewers?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <LinearGradient colors={['#F43F5E', c.live]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Pulse min={0.6} max={1.15} period={1100}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }} /></Pulse>
        <Text variant="caption" color="#FFFFFF" style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>LIVE</Text>
      </LinearGradient>
      {viewers !== undefined && <ViewerCount count={viewers} />}
    </View>
  );
}

export function ViewerCount({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(6,24,38,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 }} accessibilityLabel={`${count} watching`}>
      <Ionicons name="eye-outline" size={13} color="#fff" />
      <Text variant="caption" color="#fff">{compactNumber(count)}</Text>
    </View>
  );
}

/** Blue verified tick: a blue seal with a white check (verified hosts, and accounts the owner verified). */
export function VerifiedTick({ size = 18, label = 'Verified' }: { size?: number; label?: string }) {
  const { c } = useTheme();
  return (
    <LinearGradient
      colors={['#38BDF8', '#1D9BF0', '#0369A1']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', borderWidth: Math.max(1, size / 12), borderColor: c.surfaceRaised }}
    >
      <Ionicons name="checkmark" size={size * 0.62} color="#FFFFFF" />
    </LinearGradient>
  );
}

/** Earned by passing host identity verification: the blue tick, with "Verified host" beside it when `withText`. */
export function HostBadge({ small, withText }: { small?: boolean; withText?: boolean }) {
  const { c } = useTheme();
  const tick = <VerifiedTick size={small ? 14 : 18} label="Verified host" />;
  if (!withText) return tick;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {tick}
      <Text variant="caption" color={c.primary} style={{ fontSize: small ? 11 : 12, fontWeight: '700' }}>Verified host</Text>
    </View>
  );
}

/** Owners of an agency (profiles.role AGENCY_ADMIN). Separate from, and can sit next to, the Host badge. */
export function AgencyOwnerBadge({ small }: { small?: boolean }) {
  const { c } = useTheme();
  return (
    <LinearGradient
      colors={c.goldGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      accessibilityLabel="Agency owner"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 7, paddingHorizontal: small ? 5 : 8, paddingVertical: small ? 1 : 3 }}
    >
      <Ionicons name="business" size={small ? 10 : 12} color={c.onGold} />
      <Text variant="caption" color={c.onGold} style={{ fontSize: small ? 10 : 11, fontWeight: '700' }}>Agency owner</Text>
    </LinearGradient>
  );
}

/** Blue tick (verified host or owner-verified account) and/or the Agency owner tag; nothing when neither applies. */
export function RoleBadges({ profile, small }: { profile?: { verified_at?: string | null; owner_verified_at?: string | null; role?: string | null } | null; small?: boolean }) {
  const host = !!profile?.verified_at;
  const ticked = host || !!profile?.owner_verified_at;
  const owner = profile?.role === 'AGENCY_ADMIN';
  if (!ticked && !owner) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {ticked && <VerifiedTick size={small ? 14 : 18} label={host ? 'Verified host' : 'Verified account'} />}
      {owner && <AgencyOwnerBadge small={small} />}
    </View>
  );
}

/** Gold coin glyph used next to balances and prices. */
/** Icon of the unit viewers buy and send (Zynalive: a diamond). */
export function Coin({ size = 16 }: { size?: number }) {
  return <Ionicons name="diamond" size={size} color="#38BDF8" accessible={false} />;
}

/** Icon of the unit hosts earn (Zynalive: a bean): a small golden-brown bean with a crease. */
export function Bean({ size = 16 }: { size?: number }) {
  return (
    <View accessible={false} style={{ width: size * 0.78, height: size, borderRadius: size / 2, backgroundColor: '#E2A33A', borderWidth: Math.max(1, size / 12), borderColor: '#9A6200', transform: [{ rotate: '-28deg' }], alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: Math.max(1.5, size / 10), height: size * 0.55, borderRadius: size, backgroundColor: '#9A6200', opacity: 0.7 }} />
    </View>
  );
}

export function compactNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function Input({ label, error, style, onFocus, onBlur, ...props }: TextInputProps & { label?: string; error?: string | null }) {
  const { c, radius, type } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label && <Text variant="bodySmall" muted style={{ fontWeight: '500' }}>{label}</Text>}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textFaint}
        style={[
          type.body as TextStyle,
          { fontFamily: fonts.regular, backgroundColor: c.surfaceRaised, color: c.text, borderColor: error ? c.danger : focused ? c.primary : c.violetBorder, borderWidth: 1, borderRadius: radius[12] + 2, paddingHorizontal: 16, minHeight: 52 },
          focused && !error ? { shadowColor: c.primary, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } } : null,
          style,
        ]}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        {...props}
      />
      {error && <Text variant="bodySmall" color={c.danger}>{error}</Text>}
    </View>
  );
}

export function Row({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

/** Tappable list row with icon and chevron (settings / profile menus). */
/** `value` shows the current setting on the right (e.g. "Everyone"). */
export function ListRow({ icon, label, onPress, color, last, value }: { icon: IconName; label: string; onPress: () => void; color?: string; last?: boolean; value?: string }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityHint={value} scaleTo={0.98}>
      <Row gap={12} style={{ minHeight: 56, paddingHorizontal: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.divider }}>
        {/* Aurora dark: a softly tinted icon tile (danger rows keep their own colour). */}
        <LinearGradient colors={color ? [`${color}22`, `${color}22`] : [c.violetSurface, c.violetBorder]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={18} color={color ?? c.primary} />
        </LinearGradient>
        <Text style={{ flex: 1, fontWeight: '500' }} color={color}>{label}</Text>
        {value ? <Text variant="caption" muted numberOfLines={1} style={{ maxWidth: 150 }}>{value}</Text> : null}
        <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
      </Row>
    </PressScale>
  );
}

/** Bottom sheet built on Modal (no extra native deps). */
/** `tone="live"` gives the dark navy sheet used over live video (gifts). */
export function Sheet({ visible, onClose, title, children, tone = 'light' }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; tone?: 'light' | 'live' }) {
  const { c: light, radius, scheme } = useTheme();
  const c = tone === 'live' ? liveColors : light;
  // Frosted only where the backdrop blur exists (iOS, web); the dark Midnight preset gets dark frost.
  const frost = tone === 'light' && Platform.OS !== 'android';
  const frostFill = scheme === 'dark' ? 'rgba(20,20,24,0.78)' : 'rgba(255,255,255,0.78)';
  // Over video the sheet must be solid: presets whose surface is see-through glass (Aurora) use the tab-bar colour.
  const liveSheetFill = c.surface.startsWith('#') ? c.surface : c.tabBar;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: tone === 'live' ? liveSheetFill : frost ? frostFill : c.tabBar, borderTopLeftRadius: radius[24] + 4, borderTopRightRadius: radius[24] + 4, borderWidth: 1, borderColor: tone === 'live' ? c.border : light.glassEdge, padding: 20, gap: 12, maxHeight: '80%', overflow: 'hidden' }}>
        {frost && <GlassBlur intensity={60} tint={scheme === 'dark' ? 'dark' : 'light'} />}
        {tone === 'light' && <GlassSheen radius={radius[24] + 4} />}
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border }} />
        {title && <Text variant="h2" color={c.text}>{title}</Text>}
        {children}
      </SafeAreaView>
    </Modal>
  );
}
