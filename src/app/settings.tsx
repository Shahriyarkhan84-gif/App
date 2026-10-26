import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { FramedAvatar } from '@/components/FramedAvatar';
import { Button, Card, Chip, ListRow, Row, Screen, Text } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { flag } from '@/lib/country';
import { LANGUAGES, useI18n, type Language } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

export default function SettingsScreen() {
  const { signOut } = useClerk();
  const { c } = useTheme();
  const { t, saved, setLanguage } = useI18n();
  const { profile } = useProfile();

  const choose = async (code: Language | null) => {
    const needsRestart = await setLanguage(code);
    if (needsRestart) Alert.alert(t('settings.language'), t('settings.language.restart'));
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Text variant="h1">{t('settings.title')}</Text>

        {profile && (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
            <FramedAvatar uri={profile.avatar_url} name={displayName(profile)} size={52} ring={c.primary} frameId={profile.active_frame_id} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="h3" numberOfLines={1}>{displayName(profile)}</Text>
              <Text variant="caption" faint>ID {profile.user_number}{profile.country ? ` · ${flag(profile.country)} ${profile.country}` : ''}</Text>
            </View>
            <Button title="Edit" variant="ghost" size="sm" onPress={() => router.push('/profile-edit')} />
          </Card>
        )}

        <Section title="Account">
          <ListRow icon="person-outline" label="Edit profile" onPress={() => router.push('/profile-edit')} last />
        </Section>

        <View style={{ gap: 8 }}>
          <SectionTitle>{t('settings.language')}</SectionTitle>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Chip label={t('settings.language.device')} selected={saved === null} onPress={() => void choose(null)} />
            {LANGUAGES.map((l) => <Chip key={l.code} label={l.name} selected={saved === l.code} onPress={() => void choose(l.code)} />)}
          </Row>
        </View>

        <Section title="About">
          <ListRow icon="document-text-outline" label="Terms of Service" onPress={() => router.push('/terms')} />
          <ListRow icon="lock-closed-outline" label={t('settings.privacy')} onPress={() => router.push('/privacy')} />
          <ListRow icon="help-circle-outline" label="Help & support" onPress={() => router.push('/support')} last />
        </Section>

        <Button title={t('settings.signOut')} variant="secondary" style={{ backgroundColor: c.surfaceRaised, borderColor: c.violetBorder }}
          onPress={() => confirmAction(t('settings.signOut'), 'You can sign back in any time.', t('settings.signOut'), () => void signOut().then(() => router.replace('/')))} />
        <Button title={t('settings.delete')} variant="ghost" onPress={() => router.push('/delete-account')} style={{ marginTop: -8 }} icon={<Ionicons name="trash-outline" size={16} color={c.danger} />} />
      </ScrollView>
    </Screen>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text variant="caption" muted style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{children}</Text>;
}

/** A titled group of rows on one frosted card. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <SectionTitle>{title}</SectionTitle>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>{children}</Card>
    </View>
  );
}
