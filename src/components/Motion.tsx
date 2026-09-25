import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

/** Fades + slides its children in after `delay` ms (skipped when Reduce Motion is on). */
export function FadeIn({ delay = 0, from = 16, duration = 420, children, style }: { delay?: number; from?: number; duration?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      anim = Animated.timing(v, { toValue: 1, duration: reduce ? 0 : duration, delay: reduce ? 0 : delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
      anim.start();
    });
    return () => anim?.stop();
  }, [v, delay, duration]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Gentle endless up/down float (decorative). */
export function Float({ distance = 6, period = 2600, offset = 0, children, style }: { distance?: number; period?: number; offset?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.delay(offset),
          Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => loop?.stop();
  }, [v, period, offset]);
  return <Animated.View style={[style, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }] }]}>{children}</Animated.View>;
}

/** Delay for the i-th item of a staggered list (capped so long lists don't lag). */
export const stagger = (i: number, step = 60, max = 480) => Math.min(i * step, max);

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => live && setReduce(r));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Springs children in from a smaller scale (success ticks, badges, code digits). */
export function Pop({ delay = 0, from = 0.4, children, style }: { delay?: number; from?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    const anim = Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true })]);
    anim.start();
    return () => anim.stop();
  }, [v, delay, reduce]);
  return (
    <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Endless gentle scale pulse (live dots, hearts). */
export function Pulse({ min = 1, max = 1.12, period = 1400, children, style }: { min?: number; max?: number; period?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, period, reduce]);
  return <Animated.View style={[style, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [min, max] }) }] }]}>{children}</Animated.View>;
}

/** Expanding, fading ring behind a round button (the Go live tab). */
export function Ripple({ size, color, period = 2200 }: { size: number; color: string; period?: number }) {
  const reduce = useReduceMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: period, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v, period, reduce]);
  if (reduce) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
      }}
    />
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that springs down slightly while pressed. */
export function PressScale({ scaleTo = 0.96, style, onPressIn, onPressOut, children, ...rest }: Omit<PressableProps, 'style' | 'children'> & { scaleTo?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const [v] = useState(() => new Animated.Value(1));
  const to = (value: number) => Animated.spring(v, { toValue: value, friction: 6, tension: 260, useNativeDriver: true }).start();
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        to(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      style={[style, { transform: [{ scale: v }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Grows a bar from zero to its full height (charts). */
export function GrowBar({ height, delay = 0, style }: { height: number; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: reduce ? 0 : 600, delay: reduce ? 0 : delay, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [v, delay, reduce]);
  return <Animated.View style={[style, { height: v.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }]} />;
}

/** Slides children in horizontally (gift toasts). */
export function SlideIn({ from = -80, delay = 0, children, style }: { from?: number; delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.spring(v, { toValue: 1, delay: reduce ? 0 : delay, friction: 7, tension: 90, useNativeDriver: true });
    if (reduce) v.setValue(1);
    else anim.start();
    return () => anim.stop();
  }, [v, delay, reduce]);
  return <Animated.View style={[style, { transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }]}>{children}</Animated.View>;
}
