import { Tabs } from 'expo-router';

import { TabBarCenterButton, TabBarGlass, tabButton, useTabBarStyle } from '@/components/Menus';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

// User app navigation: Home · Party · [+ Go live] · Messages · Me
export default function TabsLayout() {
  const { c } = useTheme();
  const { t } = useI18n();
  const tabBarStyle = useTabBarStyle();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarStyle, tabBarBackground: () => <TabBarGlass />, sceneStyle: { backgroundColor: c.background } }}>
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarButton: tabButton('home-outline', 'home', t('tab.home')) }} />
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
