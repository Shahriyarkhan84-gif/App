import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { brand } from '@/lib/brand';
import { useTheme } from '@/lib/theme';

import { FadeIn } from './Motion';
import { Text, Wordmark } from './ui';

const FEATHER = 18;

type Steps = Record<'pop' | 'wink' | 'word', Animated.Value>;

/** Kitty pops in, gives a little nod, then the name is written out. */
function useIntro(): Steps {
  const [v] = useState<Steps>(() => ({ pop: new Animated.Value(0), wink: new Animated.Value(0), word: new Animated.Value(0) }));
  useEffect(() => {
    let live = true;
    let anim: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!live) return;
      if (reduce) {
        Object.values(v).forEach((x) => x.setValue(1));
        return;
      }
      const to = (x: Animated.Value, duration: number, easing: (t: number) => number) =>
        Animated.timing(x, { toValue: 1, duration, easing, useNativeDriver: true });
      anim = Animated.sequence([
        to(v.pop, 520, Easing.out(Easing.back(1.8))),
        Animated.parallel([to(v.wink, 600, Easing.inOut(Easing.quad)), to(v.word, 800, Easing.inOut(Easing.cubic))]),
      ]);
      anim.start();
    });
    return () => {
      live = false;
      anim?.stop();
    };
  }, [v]);
  return v;
}

/** The app icon (the Kitty mascot): grows in with a bounce, then tilts its head once. */
function MascotLogo({ size, v }: { size: number; v: Steps }) {
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        opacity: v.pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
        transform: [
          { scale: v.pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
          { rotate: v.wink.interpolate({ inputRange: [0, 0.35, 0.7, 1], outputRange: ['0deg', '-8deg', '4deg', '0deg'] }) },
        ],
      }}
    >
      <Image source={require('../../assets/logo.png')} style={{ width: size, height: size }} contentFit="contain" />
    </Animated.View>
  );
}

/** "zynalive" revealed left to right behind a soft edge, as if being written. */
function WrittenWordmark({ size, v }: { size: number; v: Animated.Value }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <View style={{ overflow: 'hidden' }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Wordmark size={size} />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: -FEATHER,
          // Until measured, cover generously so the name never flashes in early.
          width: width ? width + FEATHER * 2 : 2000,
          flexDirection: 'row',
          transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, width + FEATHER] }) }],
        }}
      >
        <LinearGradient colors={[`${c.background}00`, c.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: FEATHER }} />
        <View style={{ flex: 1, backgroundColor: c.background }} />
      </Animated.View>
    </View>
  );
}

/** Branded loading page shown after the native splash while the app starts. */
export function LaunchScreen() {
  const { c } = useTheme();
  const intro = useIntro();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const dot = (i: number) => ({
    opacity: pulse.interpolate({ inputRange: [0, 0.2 + i * 0.2, 0.4 + i * 0.2, 1], outputRange: [0.25, 0.25, 1, 0.25], extrapolate: 'clamp' }),
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', gap: 20 }} accessibilityLabel={`Loading ${brand.name}`} accessibilityRole="progressbar">
      <MascotLogo size={104} v={intro} />
      <View style={{ alignItems: 'center', gap: 12 }}>
        <WrittenWordmark size={40} v={intro.word} />
        <FadeIn delay={1800} from={0}>
          <Text muted style={{ textAlign: 'center', paddingHorizontal: 40 }}>Go live, meet people and support the hosts you love.</Text>
        </FadeIn>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: i === 1 ? c.gold : c.primary }, dot(i)]} />
        ))}
      </View>
    </View>
  );
}
