import { StyleSheet, View } from 'react-native';

import { colors } from '@/lib/theme';

/**
 * Bottom fade over artwork, built from stacked translucent bands so we don't
 * need a native gradient module.
 */
export function LinearGradientFallback() {
  const steps = 12;
  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]} pointerEvents="none">
      {Array.from({ length: steps }, (_, i) => (
        <View
          key={i}
          style={{ height: `${60 / steps}%`, backgroundColor: colors.background, opacity: ((i + 1) / steps) ** 1.6 }}
        />
      ))}
    </View>
  );
}
