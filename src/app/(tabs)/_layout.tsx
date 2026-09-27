import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';

import type { IconName } from '@/components/ui';
import { Ripple } from '@/components/Motion';
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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: c.tabBar, borderTopColor: c.divider, height: 88, paddingTop: 8,
          borderTopLeftRadius: 400, borderTopRightRadius: 400,
        },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarButton: pillTabButton('home-outline', 'home', 'Home') }} />
      <Tabs.Screen name="party" options={{ title: 'Party', tabBarButton: pillTabButton('people-outline', 'people', 'Party') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Go live',
          tabBarAccessibilityLabel: 'Go live',
          tabBarButton: ({ onPress, accessibilityState }) => (
            <View style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ position: 'absolute', top: -18, width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                <Ripple size={56} color={c.primary} />
              </View>
              <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel="Go live"
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
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarButton: pillTabButton('chatbox-outline', 'chatbox', 'Messages') }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarButton: pillTabButton('person-outline', 'person', 'Me') }} />
    </Tabs>
  );
}
