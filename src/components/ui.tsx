import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text as RNText,
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

import { useTheme, type TypeVariant } from '@/lib/theme';

export function Text({ variant = 'body', muted, color, style, ...rest }: TextProps & { variant?: TypeVariant; muted?: boolean; color?: string }) {
  const { c, type } = useTheme();
  return <RNText style={[type[variant] as TextStyle, { color: color ?? (muted ? c.textMuted : c.text) }, style]} {...rest} />;
}

export function Screen({ children, edges = ['top'], style }: { children: ReactNode; edges?: Edge[]; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: c.background }, style]}>{children}</SafeAreaView>;
}

type ButtonProps = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, variant = 'primary', size = 'md', loading, icon, disabled, style, ...rest }: ButtonProps) {
  const { c, radius } = useTheme();
  const bg = { primary: c.primary, secondary: c.surfaceRaised, ghost: 'transparent', danger: c.danger }[variant];
  const fg = variant === 'primary' || variant === 'danger' ? c.primaryText : variant === 'ghost' ? c.textMuted : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight: size === 'md' ? 48 : 36,
          paddingHorizontal: size === 'md' ? 20 : 14,
          borderRadius: radius[12],
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: c.border,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      {!loading && <Text variant="label" color={fg} style={{ fontSize: size === 'md' ? 15 : 13 }}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, radius } = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: radius[16], borderWidth: 1, borderColor: c.border, padding: 16, gap: 8 }, style]}>
      {children}
    </View>
  );
}

export function Avatar({ uri, name, size = 40 }: { uri?: string | null; name?: string | null; size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceRaised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {uri ? (
        <Image source={uri} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Text variant="label" muted style={{ fontSize: size * 0.4 }}>{(name ?? '?').replace('@', '').slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const { c, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radius.pill,
        backgroundColor: selected ? c.primary : c.surfaceRaised,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.border,
      }}
    >
      <Text variant="label" color={selected ? c.primaryText : c.text}>{label}</Text>
    </Pressable>
  );
}

export function LiveBadge({ viewers }: { viewers?: number }) {
  const { c, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.live, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius[8] }}>
      <Text variant="caption" color="#fff" style={{ fontWeight: '800' }}>LIVE</Text>
      {viewers !== undefined && <Text variant="caption" color="#fff">👁 {viewers}</Text>}
    </View>
  );
}

export function Input({ label, error, style, ...props }: TextInputProps & { label?: string; error?: string | null }) {
  const { c, radius, type } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label && <Text variant="label" muted>{label}</Text>}
      <TextInput
        placeholderTextColor={c.textMuted}
        style={[
          type.body as TextStyle,
          { backgroundColor: c.surface, color: c.text, borderColor: error ? c.danger : c.border, borderWidth: 1, borderRadius: radius[12], paddingHorizontal: 16, minHeight: 48 },
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

/** Bottom sheet built on Modal (no extra native deps). */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const { c, radius } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.surface, borderTopLeftRadius: radius[24], borderTopRightRadius: radius[24], padding: 20, gap: 12, maxHeight: '80%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border }} />
        {title && <Text variant="h3">{title}</Text>}
        {children}
      </SafeAreaView>
    </Modal>
  );
}
