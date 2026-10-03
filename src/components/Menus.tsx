import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, View, useWindowDimensions, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pop, PressScale } from '@/components/Motion';
import { Button, Sheet, Text, type IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

// Menu kit — the eight mobile menu styles (Grid, Side menu, Tab bar, FAB,
// Sheet, Three dots, Rectangular rail, Rudder) in Zynalive's theme. All take
// the same MenuItem shape so screens can swap styles without rewiring actions.

export type MenuItem = {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

const useAnimatedValue = (initial: number) => useState(() => new Animated.Value(initial))[0];

// 1. Grid ----------------------------------------------------------------------

/** Tile grid of big icon buttons (launcher style). */
export function MenuGrid({ items, columns = 2, style }: { items: MenuItem[]; columns?: number; style?: StyleProp<ViewStyle> }) {
  const { c, radius } = useTheme();
  const gap = 12;
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>
      {items.map((item, i) => (
        <Pop key={item.key} delay={i * 40} style={{ width: `${100 / columns - 4}%`, flexGrow: 1 }}>
          <PressScale onPress={item.onPress} disabled={item.disabled} accessibilityRole="button" accessibilityLabel={item.label}>
            <LinearGradient
              colors={item.destructive ? [c.danger, c.accent] : [c.violet, c.primary]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ aspectRatio: 1, borderRadius: radius[20], alignItems: 'center', justifyContent: 'center', gap: 8, opacity: item.disabled ? 0.5 : 1 }}
            >
              <Ionicons name={item.icon} size={32} color="#fff" />
              <Text variant="label" color="#fff">{item.label}</Text>
            </LinearGradient>
          </PressScale>
        </Pop>
      ))}
    </View>
  );
}

// 2. Side menu (drawer) ---------------------------------------------------------

/** Full-height drawer sliding in from the start edge. */
export function SideMenu({ visible, onClose, items, header }: { visible: boolean; onClose: () => void; items: MenuItem[]; header?: ReactNode }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const panel = Math.min(320, width * 0.8);
  const x = useAnimatedValue(-panel);

  useEffect(() => {
    if (visible) {
      x.setValue(-panel);
      Animated.spring(x, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }).start();
    }
  }, [visible, panel, x]);

  const choose = (item: MenuItem) => {
    onClose();
    item.onPress();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Animated.View style={{ width: panel, backgroundColor: c.tabBar, transform: [{ translateX: x }], shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, elevation: 16 }}>
          <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, paddingHorizontal: 20, gap: 8 }}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('menu.close')} style={{ paddingVertical: 16, alignSelf: 'flex-start' }}>
              <Ionicons name="close" size={26} color={c.text} />
            </Pressable>
            {header}
            <ScrollView contentContainerStyle={{ gap: 4 }}>
              {items.map((item) => (
                <PressScale key={item.key} onPress={() => choose(item)} disabled={item.disabled} accessibilityRole="button" scaleTo={0.98}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, opacity: item.disabled ? 0.5 : 1 }}>
                    <Ionicons name={item.icon} size={22} color={item.destructive ? c.danger : c.text} />
                    <Text color={item.destructive ? c.danger : c.text}>{item.label}</Text>
                  </View>
                </PressScale>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
        <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel={t('menu.close')} />
      </View>
    </Modal>
  );
}

/** Hamburger button that opens a SideMenu. */
export function SideMenuButton({ items, header, color }: { items: MenuItem[]; header?: ReactNode; color?: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PressScale onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t('menu.open')} scaleTo={0.9}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="menu" size={22} color={color ?? c.text} />
      </PressScale>
      <SideMenu visible={open} onClose={() => setOpen(false)} items={items} header={header} />
    </>
  );
}

// 3. Tab bar -------------------------------------------------------------------

/** One tab: icon over label; the focused tab takes the primary color. */
export function TabBarItem({ icon, activeIcon, label, focused, onPress }: { icon: IconName; activeIcon: IconName; label: string; focused: boolean; onPress?: (e: GestureResponderEvent) => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 8, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={focused ? activeIcon : icon} size={23} color={focused ? c.primary : c.textFaint} />
      <Text variant="caption" color={focused ? c.primary : c.textFaint} style={{ fontSize: 11, fontWeight: focused ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

/** Raised round center action of the tab bar (e.g. Go live). */
export function TabBarCenterButton({ icon = 'add', label, onPress }: { icon?: IconName; label: string; onPress?: (e: GestureResponderEvent) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed }) => ({
          width: 54, height: 54, marginTop: -16, borderRadius: 27, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
          borderWidth: 4, borderColor: c.tabBar, transform: [{ scale: pressed ? 0.94 : 1 }],
          shadowColor: c.primary, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
        })}>
        <Ionicons name={icon} size={28} color={c.primaryText} />
      </Pressable>
    </View>
  );
}

/** Container styling for the bottom tab bar (edge to edge, rounded top). */
export function useTabBarStyle(): ViewStyle {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: 62 + insets.bottom, paddingBottom: insets.bottom, paddingTop: 0,
    backgroundColor: c.tabBar, borderTopWidth: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 16,
  };
}

/** Static tab bar for previews and non-router screens. */
export function TabBar({ items, value, onChange, center }: { items: (MenuItem & { activeIcon?: IconName })[]; value: string; onChange: (key: string) => void; center?: MenuItem }) {
  const { c } = useTheme();
  const half = Math.ceil(items.length / 2);
  const render = (item: MenuItem & { activeIcon?: IconName }) => (
    <TabBarItem key={item.key} icon={item.icon} activeIcon={item.activeIcon ?? item.icon} label={item.label} focused={value === item.key} onPress={() => onChange(item.key)} />
  );
  return (
    <View style={{ flexDirection: 'row', height: 62, backgroundColor: c.tabBar, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
      {items.slice(0, half).map(render)}
      {center && <TabBarCenterButton icon={center.icon} label={center.label} onPress={center.onPress} />}
      {items.slice(half).map(render)}
    </View>
  );
}

// 4. FAB (speed dial) ------------------------------------------------------------

/** Floating action button that fans out into labelled mini actions. */
export function FabMenu({ actions, icon = 'add', label, bottom = 24, style }: { actions: MenuItem[]; icon?: IconName; label: string; bottom?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const spin = useAnimatedValue(0);
  useEffect(() => {
    Animated.spring(spin, { toValue: open ? 1 : 0, friction: 6, useNativeDriver: true }).start();
  }, [open, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  return (
    <>
      {open && <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay }} onPress={() => setOpen(false)} accessibilityLabel={label} />}
      <View pointerEvents="box-none" style={[{ position: 'absolute', right: 20, bottom, alignItems: 'flex-end', gap: 12 }, style]}>
        {open && actions.map((a, i) => (
          <Pop key={a.key} delay={(actions.length - 1 - i) * 40}>
            <PressScale onPress={() => { setOpen(false); a.onPress(); }} disabled={a.disabled} accessibilityRole="button" accessibilityLabel={a.label}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ backgroundColor: c.tabBar, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text variant="caption" style={{ fontWeight: '700' }}>{a.label}</Text>
              </View>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: a.destructive ? c.danger : c.accent, alignItems: 'center', justifyContent: 'center', marginRight: 5 }}>
                <Ionicons name={a.icon} size={21} color="#fff" />
              </View>
            </PressScale>
          </Pop>
        ))}
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }}
          style={({ pressed }) => ({
            width: 58, height: 58, borderRadius: 29, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
            transform: [{ scale: pressed ? 0.94 : 1 }], shadowColor: c.accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 10,
          })}>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name={icon} size={30} color="#fff" />
          </Animated.View>
        </Pressable>
      </View>
    </>
  );
}

// 5. Sheet (action sheet) ----------------------------------------------------------

/** Bottom action sheet: icon rows plus a full-width Cancel. */
export function ActionSheet({ visible, onClose, title, actions }: { visible: boolean; onClose: () => void; title?: string; actions: MenuItem[] }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {actions.map((a) => (
        <PressScale key={a.key} onPress={() => { onClose(); a.onPress(); }} disabled={a.disabled} accessibilityRole="button" scaleTo={0.98}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12, opacity: a.disabled ? 0.5 : 1 }}>
            <Ionicons name={a.icon} size={22} color={a.destructive ? c.danger : c.text} />
            <Text color={a.destructive ? c.danger : c.text}>{a.label}</Text>
          </View>
        </PressScale>
      ))}
      <Button title={t('menu.cancel')} variant="gold" onPress={onClose} style={{ marginTop: 4 }} />
    </Sheet>
  );
}

// 6. Three dots (overflow popover) ---------------------------------------------------

/** ⋮ button that opens a popover menu anchored under it. */
export function OverflowMenu({ actions, color, label }: { actions: MenuItem[]; color?: string; label?: string }) {
  const { c, radius } = useTheme();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const anchor = useRef<View>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const open = () =>
    anchor.current?.measureInWindow((x, y, w, h) => setPos({ top: y + h + 4, right: Math.max(8, width - (x + w)) }));

  return (
    <>
      <View ref={anchor} collapsable={false}>
        <PressScale onPress={open} accessibilityRole="button" accessibilityLabel={label ?? t('menu.more')} scaleTo={0.9}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ellipsis-vertical" size={20} color={color ?? c.text} />
        </PressScale>
      </View>
      <Modal visible={!!pos} transparent animationType="fade" onRequestClose={() => setPos(null)}>
        <Pressable style={{ flex: 1 }} onPress={() => setPos(null)} accessibilityLabel={t('menu.close')}>
          {pos && (
            <Pop from={0.85} style={{ position: 'absolute', top: pos.top, right: pos.right }}>
              <View style={{ minWidth: 190, backgroundColor: c.tabBar, borderRadius: radius[16], paddingVertical: 6, borderWidth: 1, borderColor: c.divider,
                shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}>
                {actions.map((a) => (
                  <Pressable key={a.key} disabled={a.disabled} onPress={() => { setPos(null); a.onPress(); }} accessibilityRole="menuitem"
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
                      backgroundColor: pressed ? c.surfaceRaised : 'transparent', opacity: a.disabled ? 0.5 : 1 })}>
                    <Ionicons name={a.icon} size={19} color={a.destructive ? c.danger : c.text} />
                    <Text color={a.destructive ? c.danger : c.text}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Pop>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

// 7. Rectangular (navigation rail) -----------------------------------------------------

/** Vertical icon rail along the start edge — for tablets, web and split layouts. */
export function NavRail({ items, value, onChange, style }: { items: MenuItem[]; value: string; onChange: (key: string) => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ width: 72, backgroundColor: c.primary, paddingVertical: 16, alignItems: 'center', gap: 10 }, style]}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable key={item.key} onPress={() => { onChange(item.key); item.onPress(); }} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: active }}
            style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
              backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'transparent', opacity: pressed ? 0.7 : 1 })}>
            <Ionicons name={item.icon} size={24} color={c.primaryText} />
          </Pressable>
        );
      })}
    </View>
  );
}

// 8. Rudder -----------------------------------------------------------------------------

/** Minimal bottom bar: two side actions around one big center action. */
export function RudderBar({ left, center, right, style }: { left: MenuItem; center: MenuItem; right: MenuItem; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const side = (item: MenuItem) => (
    <PressScale onPress={item.onPress} accessibilityRole="button" accessibilityLabel={item.label} scaleTo={0.9}
      style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.tabBar, alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
      <Ionicons name={item.icon} size={22} color={c.accent} />
    </PressScale>
  );
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 12 }, style]}>
      {side(left)}
      <PressScale onPress={center.onPress} accessibilityRole="button" accessibilityLabel={center.label} scaleTo={0.92}
        style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
          shadowColor: c.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}>
        <Ionicons name={center.icon} size={34} color="#fff" />
      </PressScale>
      {side(right)}
    </View>
  );
}
