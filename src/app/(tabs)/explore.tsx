import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useTabBarSpace } from '@/components/Menus';
import { Pop, PressScale } from '@/components/Motion';
import { Row, Screen, Text, type IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';
import { useTheme } from '@/lib/theme';

type Shortcut = { key: string; icon: IconName; label: MessageKey; body: MessageKey; href: Href; colors: readonly [string, string] };

const WATCH: Shortcut[] = [
  { key: 'party', icon: 'people', label: 'explore.party', body: 'explore.party.body', href: '/party', colors: ['#0369A1', '#0EA5E9'] },
  { key: 'videos', icon: 'play-circle', label: 'menu.videos', body: 'explore.videos.body', href: '/videos', colors: ['#0E7490', '#22D3EE'] },
  { key: 'events', icon: 'calendar', label: 'menu.events', body: 'explore.events.body', href: '/events', colors: ['#0E8A7A', '#34C789'] },
  { key: 'rankings', icon: 'trophy', label: 'menu.rankings', body: 'explore.rankings.body', href: '/rankings', colors: ['#E0A83A', '#FFC24B'] },
];

const YOU: Shortcut[] = [
  { key: 'wallet', icon: 'wallet', label: 'menu.wallet', body: 'explore.wallet.body', href: '/wallet', colors: ['#E0A83A', '#FFC24B'] },
  { key: 'host', icon: 'videocam', label: 'explore.host', body: 'explore.host.body', href: '/hosting', colors: ['#0284C7', '#38BDF8'] },
  { key: 'agency', icon: 'business', label: 'menu.agency', body: 'explore.agency.body', href: '/agency', colors: ['#1E3A8A', '#3B82F6'] },
  { key: 'support', icon: 'help-buoy', label: 'menu.support', body: 'explore.support.body', href: '/support', colors: ['#1F6FAE', '#4B7BE0'] },
  { key: 'profile', icon: 'person-circle', label: 'explore.profile', body: 'explore.profile.body', href: '/profile-edit', colors: ['#0369A1', '#38BDF8'] },
  { key: 'settings', icon: 'settings', label: 'settings.title', body: 'explore.settings.body', href: '/settings', colors: ['#1F2937', '#4B5563'] },
];

/** Discovery hub: one place for every destination that isn't a main tab. */
export default function ExploreScreen() {
  const tabSpace = useTabBarSpace();
  const { c, hPadding, radius } = useTheme();
  const { t } = useI18n();
  let i = 0;

  const tile = (s: Shortcut) => (
    <Pop key={s.key} delay={i++ * 40} style={{ width: '48%', flexGrow: 1 }}>
      <PressScale
        haptic
        scaleTo={0.95}
        onPress={() => router.push(s.href)}
        accessibilityRole="button"
        accessibilityLabel={`${t(s.label)}. ${t(s.body)}`}
        style={{ minHeight: 112, padding: 14, gap: 10, borderRadius: radius[20], backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider }}
      >
        <LinearGradient colors={s.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={s.icon} size={22} color="#fff" />
        </LinearGradient>
        <View style={{ gap: 2 }}>
          <Text variant="label" numberOfLines={1}>{t(s.label)}</Text>
          <Text variant="caption" muted numberOfLines={2}>{t(s.body)}</Text>
        </View>
      </PressScale>
    </Pop>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingHorizontal: hPadding, paddingTop: 8, paddingBottom: tabSpace + 24, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
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
          style={{ minHeight: 48, borderRadius: radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, paddingHorizontal: 16 }}
        >
          <Row gap={10} style={{ flex: 1 }}>
            <Ionicons name="search" size={18} color={c.textFaint} />
            <Text faint>{t('explore.search')}</Text>
          </Row>
        </PressScale>

        <Text variant="label" muted style={{ marginTop: 4 }}>{t('explore.watch')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{WATCH.map(tile)}</View>

        <Text variant="label" muted style={{ marginTop: 4 }}>{t('explore.account')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{YOU.map(tile)}</View>
      </ScrollView>
    </Screen>
  );
}
