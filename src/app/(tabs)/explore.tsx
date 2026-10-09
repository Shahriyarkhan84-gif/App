import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useTabBarSpace } from '@/components/Menus';
import { Pop, PressScale } from '@/components/Motion';
import { Row, Screen, Text, type IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';
import { useTheme } from '@/lib/theme';

type Shortcut = { key: string; icon: IconName; label: MessageKey; body: MessageKey; href: Href };

const WATCH: Shortcut[] = [
  { key: 'party', icon: 'people-outline', label: 'explore.party', body: 'explore.party.body', href: '/party' },
  { key: 'videos', icon: 'play-circle-outline', label: 'menu.videos', body: 'explore.videos.body', href: '/videos' },
  { key: 'events', icon: 'calendar-outline', label: 'menu.events', body: 'explore.events.body', href: '/events' },
  { key: 'rankings', icon: 'trophy-outline', label: 'menu.rankings', body: 'explore.rankings.body', href: '/rankings' },
];

const YOU: Shortcut[] = [
  { key: 'wallet', icon: 'wallet-outline', label: 'menu.wallet', body: 'explore.wallet.body', href: '/wallet' },
  { key: 'host', icon: 'videocam-outline', label: 'explore.host', body: 'explore.host.body', href: '/hosting' },
  { key: 'agency', icon: 'business-outline', label: 'menu.agency', body: 'explore.agency.body', href: '/agency' },
  { key: 'support', icon: 'help-buoy-outline', label: 'menu.support', body: 'explore.support.body', href: '/support' },
  { key: 'profile', icon: 'person-circle-outline', label: 'explore.profile', body: 'explore.profile.body', href: '/profile-edit' },
  { key: 'settings', icon: 'settings-outline', label: 'settings.title', body: 'explore.settings.body', href: '/settings' },
];

/** Discovery hub: one place for every destination that isn't a main tab. */
export default function ExploreScreen() {
  const tabSpace = useTabBarSpace();
  const { c, hPadding, radius } = useTheme();
  const { t } = useI18n();
  let i = 0;

  // Bigo-style service grid: four per row, a flat icon square and a short label.
  const tile = (s: Shortcut) => (
    <Pop key={s.key} delay={i++ * 30} style={{ width: '25%', alignItems: 'center', paddingVertical: 8 }}>
      <PressScale
        haptic
        scaleTo={0.92}
        onPress={() => router.push(s.href)}
        accessibilityRole="button"
        accessibilityLabel={`${t(s.label)}. ${t(s.body)}`}
        style={{ alignItems: 'center', gap: 8, minWidth: 72 }}
      >
        <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={s.icon} size={24} color={s.key === 'wallet' || s.key === 'rankings' ? c.gold : c.primary} />
        </View>
        <Text variant="caption" numberOfLines={1} style={{ fontSize: 12 }}>{t(s.label)}</Text>
      </PressScale>
    </Pop>
  );

  const section = (title: string, items: Shortcut[]) => (
    <View style={{ borderRadius: radius[12], backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider, paddingVertical: 8, paddingHorizontal: 4 }}>
      <Text variant="label" style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 2 }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{items.map(tile)}</View>
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingHorizontal: hPadding, paddingTop: 8, paddingBottom: tabSpace + 24, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <View style={{ gap: 2 }}>
          <Text variant="h1">{t('explore.title')}</Text>
          <Text muted>{t('explore.subtitle')}</Text>
        </View>

        <PressScale
          haptic
          scaleTo={0.98}
          onPress={() => router.push('/party')}
          accessibilityRole="search"
          accessibilityLabel={t('explore.search')}
          style={{ minHeight: 44, borderRadius: radius[8], backgroundColor: c.surfaceRaised, paddingHorizontal: 14 }}
        >
          <Row gap={10} style={{ flex: 1 }}>
            <Ionicons name="search" size={18} color={c.textFaint} />
            <Text faint>{t('explore.search')}</Text>
          </Row>
        </PressScale>

        {section(t('explore.watch'), WATCH)}
        {section(t('explore.account'), YOU)}
      </ScrollView>
    </Screen>
  );
}
