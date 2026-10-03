import { Tabs } from 'expo-router';
import type { GestureResponderEvent } from 'react-native';

import { TabBarCenterButton, TabBarItem, useTabBarStyle } from '@/components/Menus';
import type { IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

// The tab navigator reports focus as `aria-selected`; `accessibilityState` is kept as a fallback.
type TabButtonProps = { onPress?: (e: GestureResponderEvent) => void; 'aria-selected'?: boolean; accessibilityState?: { selected?: boolean } };

/** Classic tab bar button (icon over label) from the menu kit. */
function tabButton(icon: IconName, activeIcon: IconName, label: string) {
  function TabButton({ onPress, accessibilityState, 'aria-selected': ariaSelected }: TabButtonProps) {
    return <TabBarItem icon={icon} activeIcon={activeIcon} label={label} focused={!!(ariaSelected ?? accessibilityState?.selected)} onPress={onPress} />;
  }
  TabButton.displayName = `TabButton(${label})`;
  return TabButton;
}

// User app navigation: Home · Explore · Party · [+ Go live] · Messages · Me
export default function TabsLayout() {
  const { c } = useTheme();
  const { t } = useI18n();
  const tabBarStyle = useTabBarStyle();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarStyle, sceneStyle: { backgroundColor: c.background } }}>
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarButton: tabButton('home-outline', 'home', t('tab.home')) }} />
      <Tabs.Screen name="explore" options={{ title: t('tab.explore'), tabBarButton: tabButton('compass-outline', 'compass', t('tab.explore')) }} />
      <Tabs.Screen name="party" options={{ title: t('tab.party'), tabBarButton: tabButton('people-outline', 'people', t('tab.party')) }} />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tab.golive'),
          tabBarAccessibilityLabel: t('tab.golive'),
          tabBarButton: ({ onPress }) => <TabBarCenterButton icon="add" label={t('tab.golive')} onPress={onPress} />,
        }}
      />
      <Tabs.Screen name="messages" options={{ title: t('tab.messages'), tabBarButton: tabButton('chatbox-outline', 'chatbox', t('tab.messages')) }} />
      <Tabs.Screen name="profile" options={{ title: t('tab.me'), tabBarButton: tabButton('person-outline', 'person', t('tab.me')) }} />
    </Tabs>
  );
}
