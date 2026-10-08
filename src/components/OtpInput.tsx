import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { Text } from './ui';

/**
 * Six-box verification code input (OTP). One real TextInput sits invisibly over the boxes, so
 * paste, SMS/email code autofill and the backspace key all work on Android and iOS; the boxes
 * only display it. Accepts digits only. `onComplete` fires once all six digits are entered.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  error = false,
  disabled = false,
  label = 'Verification code',
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  length?: number;
  error?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const { c } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [shake] = useState(() => new Animated.Value(0));

  // A wrong code shakes the row.
  useEffect(() => {
    if (!error) return;
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [error, shake]);

  const handle = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length && digits !== value) onComplete?.(digits);
  };

  const active = Math.min(value.length, length - 1);

  return (
    <View style={{ gap: 8 }}>
      <Text variant="label">{label}</Text>
      <Animated.View style={{ transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) }] }}>
        <Pressable onPress={() => input.current?.focus()} accessible={false} style={styles.row}>
          {Array.from({ length }, (_, i) => {
            const char = value[i] ?? '';
            const isActive = focused && i === active && !disabled;
            return (
              <Box
                key={i}
                char={char}
                borderColor={error ? c.danger : isActive ? c.primary : char ? c.primary : c.border}
                background={char ? c.surfaceRaised : c.surface}
                textColor={c.text}
                caret={isActive && !char}
                caretColor={c.primary}
              />
            );
          })}
          <TextInput
            ref={input}
            value={value}
            onChangeText={handle}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!disabled}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={length}
            autoFocus
            caretHidden
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            accessibilityLabel={`${label}, ${length} digits`}
            // Invisible but tappable and full-size, so long-press → Paste works over the boxes.
            style={[StyleSheet.absoluteFill, { opacity: 0.011, color: 'transparent' }]}
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function Box({ char, borderColor, background, textColor, caret, caretColor }: {
  char: string; borderColor: string; background: string; textColor: string; caret: boolean; caretColor: string;
}) {
  // Each digit pops in as it's typed.
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!char) return;
    scale.setValue(0.85);
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [char, scale]);

  return (
    <Animated.View style={[styles.box, { borderColor, backgroundColor: background, transform: [{ scale }] }]}>
      {char ? (
        <Text variant="h2" color={textColor}>{char}</Text>
      ) : caret ? (
        <View style={{ width: 2, height: 24, borderRadius: 1, backgroundColor: caretColor }} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  box: { flex: 1, maxWidth: 52, height: 56, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
