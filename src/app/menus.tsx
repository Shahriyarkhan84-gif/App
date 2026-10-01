import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import {
  ActionSheet, FabMenu, MenuGrid, NavRail, OverflowMenu, RudderBar, SideMenu, TabBar, type MenuItem,
} from '@/components/Menus';
import { FadeIn } from '@/components/Motion';
import { Button, Row, Screen, Text } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/** Phone-shaped frame each style is previewed in. */
function Frame({ title, children, height = 260 }: { title: string; children: ReactNode; height?: number }) {
  const { c, radius } = useTheme();
  return (
    <FadeIn style={{ gap: 8 }}>
      <Text variant="h3">{title}</Text>
      <View style={{ height, borderRadius: radius[24], borderWidth: 1, borderColor: c.divider, backgroundColor: c.surface, overflow: 'hidden' }}>
        {children}
      </View>
    </FadeIn>
  );
}

/** Gallery of the eight menu styles in src/components/Menus.tsx (Settings → Menu styles). */
export default function MenusScreen() {
  const { c, hPadding } = useTheme();
  const { t } = useI18n();
  const [tab, setTab] = useState('home');
  const [rail, setRail] = useState('home');
  const [last, setLast] = useState<string | null>(null);
  const [side, setSide] = useState(false);
  const [sheet, setSheet] = useState(false);

  const item = (key: string, icon: MenuItem['icon'], label: string, extra?: Partial<MenuItem>): MenuItem => ({ key, icon, label, onPress: () => setLast(label), ...extra });
  const items = [
    item('home', 'home-outline', t('tab.home')),
    item('videos', 'play-circle-outline', t('menu.videos')),
    item('events', 'calendar-outline', t('menu.events')),
    item('rankings', 'trophy-outline', t('menu.rankings')),
  ];
  const tabs = [
    { ...item('home', 'home-outline', t('tab.home')), activeIcon: 'home' as const },
    { ...item('party', 'people-outline', t('tab.party')), activeIcon: 'people' as const },
    { ...item('messages', 'chatbox-outline', t('tab.messages')), activeIcon: 'chatbox' as const },
    { ...item('me', 'person-outline', t('tab.me')), activeIcon: 'person' as const },
  ];
  const actions = [
    item('share', 'share-social-outline', t('videos.share')),
    item('events', 'calendar-outline', t('menu.events')),
    item('remove', 'trash-outline', t('videos.remove'), { destructive: true }),
  ];

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('menu.styles') }} />
      <ScrollView contentContainerStyle={{ padding: hPadding, gap: 24, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        {last && <Text muted>→ {last}</Text>}

        <Frame title={`1 · ${t('menu.style.grid')}`} height={340}>
          <MenuGrid items={items} style={{ padding: 16 }} />
        </Frame>

        <Frame title={`2 · ${t('menu.style.side')}`} height={120}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Button title={t('menu.open')} variant="secondary" onPress={() => setSide(true)} />
          </View>
        </Frame>

        <Frame title={`3 · ${t('menu.style.tabBar')}`} height={140}>
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <TabBar items={tabs} value={tab} onChange={setTab} center={item('live', 'add', t('tab.golive'))} />
          </View>
        </Frame>

        <Frame title={`4 · ${t('menu.style.fab')}`} height={300}>
          <FabMenu label={t('menu.create')} bottom={16} actions={[
            item('upload', 'cloud-upload-outline', t('videos.upload')),
            item('live', 'videocam', t('tab.golive')),
            item('events', 'calendar-outline', t('menu.events')),
          ]} />
        </Frame>

        <Frame title={`5 · ${t('menu.style.sheet')}`} height={120}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Button title={t('menu.open')} variant="secondary" onPress={() => setSheet(true)} />
          </View>
        </Frame>

        <Frame title={`6 · ${t('menu.style.dots')}`} height={120}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, height: 56, backgroundColor: c.tabBar }}>
            <Text variant="h3">{t('menu.videos')}</Text>
            <OverflowMenu actions={actions} />
          </Row>
        </Frame>

        <Frame title={`7 · ${t('menu.style.rail')}`} height={300}>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <NavRail items={items} value={rail} onChange={setRail} />
            <View style={{ flex: 1, padding: 16 }}>
              <Text variant="h3">{items.find((i) => i.key === rail)?.label}</Text>
            </View>
          </View>
        </Frame>

        <Frame title={`8 · ${t('menu.style.rudder')}`} height={140}>
          <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 8 }}>
            <RudderBar
              left={item('home', 'home-outline', t('tab.home'))}
              center={item('live', 'videocam', t('tab.golive'))}
              right={item('me', 'person-outline', t('tab.me'))}
            />
          </View>
        </Frame>
      </ScrollView>

      <SideMenu visible={side} onClose={() => setSide(false)} items={items} />
      <ActionSheet visible={sheet} onClose={() => setSheet(false)} title={t('menu.more')} actions={actions} />
    </Screen>
  );
}
