import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/lib/theme';

type Props = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  icon?: string;
  style?: ViewStyle;
};

export function Button({ title, variant = 'primary', loading, icon, disabled, style, ...rest }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        (pressed || disabled) && { opacity: 0.7 },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[styles.label, variant === 'ghost' && { color: colors.textMuted }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  label: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
