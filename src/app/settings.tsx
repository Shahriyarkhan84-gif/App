import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';

import { Button, Chip, ListRow, Row, Screen, Text } from '@/components/ui';
import { LANGUAGES, useI18n, type Language } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { signOut } = useClerk();
  const { c } = useTheme();
  const { t, saved, setLanguage } = useI18n();

  const choose = async (code: Language | null) => {
    const needsRestart = await setLanguage(code);
    if (needsRestart) Alert.alert(t('settings.language'), t('settings.language.restart'));
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Text variant="h1">{t('settings.title')}</Text>

        <View style={{ gap: 8 }}>
          <Text variant="h3">{t('settings.language')}</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Chip label={t('settings.language.device')} selected={saved === null} onPress={() => void choose(null)} />
            {LANGUAGES.map((l) => <Chip key={l.code} label={l.name} selected={saved === l.code} onPress={() => void choose(l.code)} />)}
          </Row>
        </View>

        <ListRow icon="lock-closed-outline" label={t('settings.privacy')} onPress={() => router.push('/privacy')} last />

        <Button title={t('settings.signOut')} variant="ghost" onPress={() => signOut()} />
        <Button title={t('settings.delete')} variant="ghost" onPress={() => router.push('/delete-account')} style={{ marginTop: -8 }} icon={<Ionicons name="trash-outline" size={16} color={c.danger} />} />
      </ScrollView>
    </Screen>
  );
}
