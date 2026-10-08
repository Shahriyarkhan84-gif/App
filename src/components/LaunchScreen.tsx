import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { FadeIn } from './Motion';
import { Text, Wordmark } from './ui';

// Logo geometry on a 512px grid, measured from assets/logo.png so the drawn
// logo matches the app icon exactly.
const GRID = 512;
const TILE_RADIUS = 115;
const TOP_BAR = { left: 136, top: 129, width: 208, height: 58 };
const BOTTOM_BAR = { left: 131, top: 356, width: 218, height: 57 };
// The diagonal is a rotated bar clipped to this box, which gives it the icon's flat ends.
const DIAG_CLIP = { left: 131, top: 129, width: 213, height: 284 };
const DIAG = { x: 216.4, y: 21, length: 320, thickness: 61.4, angle: '131.45deg' };
const DOT = { left: 374, top: 49, size: 86 };
const LOGO_GRADIENT = ['#0EA5E9', '#5AC8FA', '#B5E4FC'] as const;
const FEATHER = 18;

type Strokes = Record<'tile' | 'top' | 'diag' | 'bottom' | 'dot' | 'word', Animated.Value>;

function useWriting(): Strokes {
  const [v] = useState<Strokes>(() => ({
    tile: new Animated.Value(0),
    top: new Animated.Value(0),
    diag: new Animated.Value(0),
    bottom: new Animated.Value(0),
    dot: new Animated.Value(0),
    word: new Animated.Value(0),
  }));
  useEffect(() => {
    let live = true;
    let anim: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!live) return;
      if (reduce) {
        Object.values(v).forEach((x) => x.setValue(1));
        return;
      }
      const stroke = (x: Animated.Value, duration: number, easing = Easing.inOut(Easing.quad)) =>
        Animated.timing(x, { toValue: 1, duration, easing, useNativeDriver: true });
      // Each stroke starts where the last one ended, like a pen that never lifts.
      anim = Animated.sequence([
        stroke(v.tile, 200, Easing.out(Easing.cubic)),
        stroke(v.top, 220),
        stroke(v.diag, 300),
        stroke(v.bottom, 220),
        Animated.parallel([stroke(v.dot, 180, Easing.out(Easing.back(2))), stroke(v.word, 800, Easing.inOut(Easing.cubic))]),
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

/** The Z icon, drawn in code so each stroke can be written on in turn. */
function WrittenLogo({ size, v }: { size: number; v: Strokes }) {
  const k = size / GRID;
  const box = (b: { left: number; top: number; width: number; height: number }) => ({
    position: 'absolute' as const, left: b.left * k, top: b.top * k, width: b.width * k, height: b.height * k,
  });
  const grow = (x: Animated.Value) => ({ transformOrigin: 'left center', transform: [{ scaleX: x }] });
  return (
    <Animated.View style={{ width: size, height: size, opacity: v.tile }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={LOGO_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: TILE_RADIUS * k }} />
      <Animated.View style={[box(TOP_BAR), { backgroundColor: '#fff' }, grow(v.top)]} />
      <View style={[box(DIAG_CLIP), { overflow: 'hidden' }]}>
        <Animated.View
          style={{
            position: 'absolute',
            left: DIAG.x * k,
            top: (DIAG.y - DIAG.thickness / 2) * k,
            width: DIAG.length * k,
            height: DIAG.thickness * k,
            backgroundColor: '#fff',
            transformOrigin: 'left center',
            transform: [{ rotate: DIAG.angle }, { scaleX: v.diag }],
          }}
        />
      </View>
      <Animated.View style={[box(BOTTOM_BAR), { backgroundColor: '#fff' }, grow(v.bottom)]} />
      <Animated.View
        style={{
          ...box({ left: DOT.left, top: DOT.top, width: DOT.size, height: DOT.size }),
          borderRadius: (DOT.size / 2) * k,
          backgroundColor: '#fff',
          opacity: v.dot.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
          transform: [{ scale: v.dot }],
        }}
      />
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
  const writing = useWriting();
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
    <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', gap: 20 }} accessibilityLabel="Loading Zynalive" accessibilityRole="progressbar">
      <WrittenLogo size={96} v={writing} />
      <View style={{ alignItems: 'center', gap: 12 }}>
        <WrittenWordmark size={40} v={writing.word} />
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
