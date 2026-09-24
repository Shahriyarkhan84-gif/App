import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { FadeIn } from './Motion';
import { Text, Wordmark } from './ui';

const logo = require('../../assets/logo.png');

/** Branded loading page shown after the native splash while the app starts. */
export function LaunchScreen() {
  const { c } = useTheme();
  const [intro] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(intro, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [intro, pulse]);

  const dot = (i: number) => ({
    opacity: pulse.interpolate({ inputRange: [0, 0.2 + i * 0.2, 0.4 + i * 0.2, 1], outputRange: [0.25, 0.25, 1, 0.25], extrapolate: 'clamp' }),
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', gap: 20 }} accessibilityLabel="Loading Zynalive" accessibilityRole="progressbar">
      <Animated.View style={{ opacity: intro, transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
        <Image source={logo} style={{ width: 96, height: 96 }} contentFit="contain" accessibilityIgnoresInvertColors />
      </Animated.View>
      <FadeIn delay={250} style={{ alignItems: 'center', gap: 12 }}>
        <Wordmark size={40} />
        <Text muted style={{ textAlign: 'center', paddingHorizontal: 40 }}>Go live, meet people and support the hosts you love.</Text>
      </FadeIn>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: i === 1 ? c.gold : c.primary }, dot(i)]} />
        ))}
      </View>
    </View>
  );
}
