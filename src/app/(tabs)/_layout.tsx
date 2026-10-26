import { Tabs } from 'expo-router';

import { DesktopSidebar, TabBarCenterButton, TabBarGlass, tabButton, useTabBarStyle, type SidebarTab } from '@/components/Menus';
import { hasFeature } from '@/lib/brand';
import { useI18n } from '@/lib/i18n';
import { useIsDesktop } from '@/lib/layout';
import { useHasUnread } from '@/lib/unread';
import { useTheme } from '@/lib/theme';

// User app navigation: Home · Party · [+ Go live] · Messages · Me. Phones get the floating dock at
// the bottom; computers (web, 1024px+) get the same tabs as a left sidebar.
export default function TabsLayout() {
  const { c } = useTheme();
  const { t } = useI18n();
  const tabBarStyle = useTabBarStyle();
  const desktop = useIsDesktop();
  const sidebarTabs: SidebarTab[] = [
    { name: 'index', icon: 'home-outline', activeIcon: 'home', label: t('tab.home') },
    ...(hasFeature('partyRooms') ? [{ name: 'party', icon: 'people-outline', activeIcon: 'people', label: t('tab.party') } as SidebarTab] : []),
    { name: 'messages', icon: 'chatbox-outline', activeIcon: 'chatbox', label: t('tab.messages'), useBadge: useHasUnread },
    { name: 'profile', icon: 'person-outline', activeIcon: 'person', label: t('tab.me') },
  ];
  return (
    <Tabs
      tabBar={desktop ? (props) => <DesktopSidebar {...props} tabs={sidebarTabs} goLive={{ name: 'create', label: t('tab.golive') }} /> : undefined}
      screenOptions={{
        headerShown: false, tabBarShowLabel: false, sceneStyle: { backgroundColor: c.background },
        ...(desktop ? { tabBarPosition: 'left' as const } : { tabBarStyle, tabBarBackground: () => <TabBarGlass /> }),
      }}>
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarButton: tabButton('home-outline', 'home', t('tab.home')) }} />
      <Tabs.Screen name="party" options={{ title: t('tab.party'), href: hasFeature('partyRooms') ? undefined : null, tabBarButton: hasFeature('partyRooms') ? tabButton('people-outline', 'people', t('tab.party')) : () => null }} />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tab.golive'),
          tabBarAccessibilityLabel: t('tab.golive'),
          tabBarButton: ({ onPress }) => <TabBarCenterButton icon="add" label={t('tab.golive')} onPress={onPress} />,
        }}
      />
      <Tabs.Screen name="messages" options={{ title: t('tab.messages'), tabBarButton: tabButton('chatbox-outline', 'chatbox', t('tab.messages'), useHasUnread) }} />
      <Tabs.Screen name="profile" options={{ title: t('tab.me'), tabBarButton: tabButton('person-outline', 'person', t('tab.me')) }} />
    </Tabs>
  );
}
