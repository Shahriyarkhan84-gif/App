import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { brand } from '@/lib/brand';
import { useTheme } from '@/lib/theme';

import { FadeIn } from './Motion';
import { SkyBackground, Text, Wordmark } from './ui';

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
        Animated.parallel([
          to(v.wink, 600, Easing.inOut(Easing.quad)),
          // Width can't run on the native driver.
          Animated.timing(v.word, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
        ]),
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

/** "zynalive" revealed left to right, as if being written: a clip that widens over the name, so it works on any background. */
function WrittenWordmark({ size, v }: { size: number; v: Animated.Value }) {
  const [width, setWidth] = useState(0);
  return (
    <View>
      {/* Invisible copy to measure the full width. */}
      <View style={{ opacity: 0 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}><Wordmark size={size} /></View>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden', width: v.interpolate({ inputRange: [0, 1], outputRange: [0, width || 1] }) }}>
        <View style={{ width: width || undefined }}><Wordmark size={size} /></View>
      </Animated.View>
    </View>
  );
}

/** Aurora dark: a cyan-to-violet ring that breathes around the logo while the app loads. */
function GlowRing({ size, pulse }: { size: number; pulse: Animated.Value }) {
  const { c } = useTheme();
  // Wide enough that the rounded-square icon sits fully inside the circle.
  const ring = Math.round(size * 1.42);
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', width: ring, height: ring, borderRadius: ring / 2,
      shadowColor: c.primary, shadowOpacity: 0.7, shadowRadius: 28, shadowOffset: { width: 0, height: 0 },
      opacity: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.96, 1.04, 0.96] }) }],
    }}>
      <LinearGradient colors={c.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: ring / 2, padding: 3 }}>
        <View style={{ flex: 1, borderRadius: ring / 2, backgroundColor: c.background }} />
      </LinearGradient>
    </Animated.View>
  );
}

/** Branded loading page shown after the native splash while the app starts. */
export function LaunchScreen() {
  const { c } = useTheme();
  const intro = useIntro();
  const [pulse] = useState(() => new Animated.Value(0));
  const [breath] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    const glow = Animated.loop(Animated.timing(breath, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }));
    loop.start();
    glow.start();
    return () => { loop.stop(); glow.stop(); };
  }, [pulse, breath]);

  const dot = (i: number) => ({
    opacity: pulse.interpolate({ inputRange: [0, 0.2 + i * 0.2, 0.4 + i * 0.2, 1], outputRange: [0.25, 0.25, 1, 0.25], extrapolate: 'clamp' }),
  });

  return (
    <SkyBackground>
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }} accessibilityLabel={`Loading ${brand.name}`} accessibilityRole="progressbar">
      <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
        {c.aurora && <GlowRing size={104} pulse={breath} />}
        <MascotLogo size={104} v={intro} />
      </View>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <WrittenWordmark size={40} v={intro.word} />
        <FadeIn delay={1800} from={0}>
          <Text muted style={{ textAlign: 'center', paddingHorizontal: 40 }}>Go live, meet people and support the hosts you love.</Text>
        </FadeIn>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: [c.accentGradient[0], c.violet, c.gold][i] }, dot(i)]} />
        ))}
      </View>
    </View>
    </SkyBackground>
  );
}
