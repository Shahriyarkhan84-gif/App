import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
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

import { bodyFont, fonts, useTheme, type TypeVariant } from '@/lib/theme';

import { PressScale, Pulse } from './Motion';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Text({ variant = 'body', muted, faint, color, style, ...rest }: TextProps & { variant?: TypeVariant; muted?: boolean; faint?: boolean; color?: string }) {
  const { c, type } = useTheme();
  const base = type[variant] as TextStyle;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  // Custom fonts ship one file per weight: pick the face, and keep fontWeight
  // 'normal' so Android doesn't synthesise bold on top of it.
  const fontFamily = flat.fontFamily ?? base.fontFamily ?? bodyFont(flat.fontWeight ?? base.fontWeight);
  const loaded = fontFamily === fonts.display || fontFamily.startsWith('DMSans');
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
    <Text variant="display" accessibilityRole="header" accessibilityLabel="Zynalive" style={{ fontSize: size, lineHeight: size * 1.15 }}>
      zyna<Text variant="display" color={c.primary} style={{ fontSize: size, lineHeight: size * 1.15 }}>live</Text>
    </Text>
  );
}

export function Screen({ children, edges = ['top'], style }: { children: ReactNode; edges?: Edge[]; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: c.background }, style]}>{children}</SafeAreaView>;
}

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
  const bg = { primary: c.primary, secondary: c.surface, ghost: 'transparent', danger: c.danger, gold: c.gold, outline: 'transparent' }[variant];
  const fg = {
    primary: c.primaryText, danger: c.primaryText, gold: c.onGold, secondary: c.text, ghost: c.textMuted, outline: c.violetText,
  }[variant];
  const border = variant === 'secondary' ? c.border : variant === 'outline' ? c.violetBorder : 'transparent';
  const button = (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={[
        {
          minHeight: size === 'md' ? 52 : 40,
          paddingHorizontal: size === 'md' ? 22 : 16,
          borderRadius: radius.pill,
          backgroundColor: variant === 'primary' ? 'transparent' : bg,
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
      {variant === 'primary' && (
        <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      {loading ? <ActivityIndicator color={fg} /> : icon}
      {!loading && <Text variant="label" color={fg} style={{ fontSize: size === 'md' ? 16 : 14 }}>{title}</Text>}
    </PressScale>
  );
  // Primary CTAs get an HDR-style glow — shadow goes on an outer wrapper since
  // overflow:hidden (needed to clip the gradient to the pill shape) would
  // otherwise clip the shadow too on iOS.
  if (variant !== 'primary' || disabled) return button;
  return <View style={{ shadowColor: c.glow, shadowOpacity: 1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8, borderRadius: radius.pill }}>{button}</View>;
}

/** Round 44pt icon-only button (header actions). */
export function IconButton({ icon, label, onPress, color, badge }: { icon: IconName; label: string; onPress?: () => void; color?: string; badge?: boolean }) {
  const { c } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.9}
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={icon} size={20} color={color ?? c.text} />
      {badge && <View style={{ position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }} />}
    </PressScale>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, radius } = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: radius[16] + 2, borderWidth: 1, borderColor: c.divider, padding: 16, gap: 8 }, style]}>
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
      style={{
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: radius.pill,
        backgroundColor: selected ? c.text : c.surfaceRaised,
        borderWidth: 1,
        borderColor: selected ? c.text : c.border,
      }}
    >
      <Text variant="label" color={selected ? c.background : c.textMuted} style={{ fontWeight: '500' }}>{label}</Text>
    </PressScale>
  );
}

/** Pill segmented control (filters, periods). */
export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  const { c, radius } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: radius.pill, backgroundColor: c.surface }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.text : 'transparent' }}
          >
            <Text variant="label" color={on ? c.background : c.textMuted} style={{ fontSize: 13 }}>{o.label}</Text>
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
      <View style={{ borderRadius: 6, shadowColor: c.glow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
        <View style={{ borderRadius: 6, overflow: 'hidden' }}>
          <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Pulse min={0.6} max={1.15} period={1100}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} /></Pulse>
            <Text variant="caption" color="#fff" style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>LIVE</Text>
          </LinearGradient>
        </View>
      </View>
      {viewers !== undefined && <ViewerCount count={viewers} />}
    </View>
  );
}

export function ViewerCount({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }} accessibilityLabel={`${count} watching`}>
      <Ionicons name="eye-outline" size={13} color="#fff" />
      <Text variant="caption" color="#fff">{compactNumber(count)}</Text>
    </View>
  );
}

/** Earned by passing host identity verification. */
export function HostBadge({ small }: { small?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityLabel="Verified host"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.primary, borderRadius: 6, paddingHorizontal: small ? 5 : 8, paddingVertical: small ? 1 : 3 }}
    >
      <Ionicons name="shield-checkmark" size={small ? 10 : 12} color="#fff" />
      <Text variant="caption" color="#fff" style={{ fontSize: small ? 10 : 11, fontWeight: '700' }}>Host</Text>
    </View>
  );
}

/** Owners of an agency (profiles.role AGENCY_ADMIN). Separate from, and can sit next to, the Host badge. */
export function AgencyOwnerBadge({ small }: { small?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityLabel="Agency owner"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.gold, borderRadius: 6, paddingHorizontal: small ? 5 : 8, paddingVertical: small ? 1 : 3 }}
    >
      <Ionicons name="business" size={small ? 10 : 12} color={c.onGold} />
      <Text variant="caption" color={c.onGold} style={{ fontSize: small ? 10 : 11, fontWeight: '700' }}>Agency owner</Text>
    </View>
  );
}

/** Host and/or Agency owner tags for a profile; renders nothing when neither applies. */
export function RoleBadges({ profile, small }: { profile?: { verified_at?: string | null; role?: string | null } | null; small?: boolean }) {
  const host = !!profile?.verified_at;
  const owner = profile?.role === 'AGENCY_ADMIN';
  if (!host && !owner) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {host && <HostBadge small={small} />}
      {owner && <AgencyOwnerBadge small={small} />}
    </View>
  );
}

/** Gold coin glyph used next to balances and prices. */
export function Coin({ size = 16 }: { size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFC24B', borderWidth: Math.max(2, size / 8), borderColor: '#C98A12' }} />;
}

export function compactNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function Input({ label, error, style, ...props }: TextInputProps & { label?: string; error?: string | null }) {
  const { c, radius, type } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label && <Text variant="bodySmall" muted style={{ fontWeight: '500' }}>{label}</Text>}
      <TextInput
        placeholderTextColor={c.textFaint}
        style={[
          type.body as TextStyle,
          { fontFamily: fonts.regular, backgroundColor: c.surface, color: c.text, borderColor: error ? c.danger : c.border, borderWidth: 1, borderRadius: radius[12] + 2, paddingHorizontal: 16, minHeight: 52 },
          style,
        ]}
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
export function ListRow({ icon, label, onPress, color, last }: { icon: IconName; label: string; onPress: () => void; color?: string; last?: boolean }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} accessibilityRole="button" scaleTo={0.98}>
      <Row style={{ minHeight: 52, paddingHorizontal: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.divider }}>
        <Ionicons name={icon} size={20} color={color ?? c.text} />
        <Text style={{ flex: 1 }} color={color}>{label}</Text>
        <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
      </Row>
    </PressScale>
  );
}

/** Bottom sheet built on Modal (no extra native deps). */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const { c, radius } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.tabBar, borderTopLeftRadius: radius[24], borderTopRightRadius: radius[24], padding: 20, gap: 12, maxHeight: '80%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border }} />
        {title && <Text variant="h2">{title}</Text>}
        {children}
      </SafeAreaView>
    </Modal>
  );
}
