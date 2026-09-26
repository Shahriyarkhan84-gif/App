import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Pressable, View } from 'react-native';

import type { IconName } from '@/components/ui';
import { Ripple } from '@/components/Motion';
import { fonts, useTheme } from '@/lib/theme';

function icon(name: IconName, active: IconName) {
  const TabIcon = ({ color, focused }: { color: ColorValue; focused: boolean }) => <Ionicons name={focused ? active : name} color={color} size={24} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
}

// User app navigation (Zynalive canvas): Home · Party · Go live · Messages · Me
export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.textFaint,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: c.tabBar, borderTopColor: c.divider, height: 88, paddingTop: 8,
          borderTopLeftRadius: 400, borderTopRightRadius: 400,
        },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="party" options={{ title: 'Party', tabBarIcon: icon('people-outline', 'people') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Go live',
          tabBarLabel: () => null,
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
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: icon('chatbox-outline', 'chatbox') }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
