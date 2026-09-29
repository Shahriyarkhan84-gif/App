import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '@/components/ui';
import { Ripple } from '@/components/Motion';
import { useI18n } from '@/lib/i18n';
import { fonts, useTheme } from '@/lib/theme';

/**
 * Pill nav buttons: the focused tab expands into a colored pill with its
 * icon and label; the rest stay as plain icon-only circles.
 */
function pillTabButton(icon: IconName, activeIcon: IconName, label: string) {
  function PillTabButton({ onPress, accessibilityState }: { onPress?: (e: GestureResponderEvent) => void; accessibilityState?: { selected?: boolean } }) {
    const { c } = useTheme();
    const focused = !!accessibilityState?.selected;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          accessibilityLabel={label}
          style={
            focused
              ? { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.primary }
              : { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }
          }
        >
          <Ionicons name={focused ? activeIcon : icon} size={focused ? 18 : 20} color={focused ? c.primaryText : c.textFaint} />
          {focused && <Text style={{ color: c.primaryText, fontFamily: fonts.medium, fontSize: 12 }}>{label}</Text>}
        </Pressable>
      </View>
    );
  }
  PillTabButton.displayName = `PillTabButton(${label})`;
  return PillTabButton;
}

// User app navigation (Zynalive canvas): Home · Party · Go live · Messages · Me
export default function TabsLayout() {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 16, right: 16, bottom: insets.bottom + 12,
          height: 64, paddingTop: 0,
          backgroundColor: c.tabBar, borderWidth: 1, borderColor: c.divider, borderRadius: 400,
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
        },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarButton: pillTabButton('home-outline', 'home', t('tab.home')) }} />
      <Tabs.Screen name="party" options={{ title: t('tab.party'), tabBarButton: pillTabButton('people-outline', 'people', t('tab.party')) }} />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tab.golive'),
          tabBarAccessibilityLabel: t('tab.golive'),
          tabBarButton: ({ onPress, accessibilityState }) => (
            <View style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ position: 'absolute', top: -18, width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                <Ripple size={56} color={c.primary} />
              </View>
              <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={t('tab.golive')}
                accessibilityState={accessibilityState}
                style={({ pressed }) => ({
                  width: 56, height: 56, marginTop: -18, borderRadius: 28, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
                  opacity: pressed ? 0.85 : 1, shadowColor: c.primary, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
                })}
              >
                <Ionicons name="videocam" size={26} color={c.primaryText} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="messages" options={{ title: t('tab.messages'), tabBarButton: pillTabButton('chatbox-outline', 'chatbox', t('tab.messages')) }} />
      <Tabs.Screen name="profile" options={{ title: t('tab.me'), tabBarButton: pillTabButton('person-outline', 'person', t('tab.me')) }} />
    </Tabs>
  );
}
