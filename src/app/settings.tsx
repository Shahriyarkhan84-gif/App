import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, View } from 'react-native';

import { FramedAvatar } from '@/components/FramedAvatar';
import { Button, Card, ListRow, Screen, Text } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { brand } from '@/lib/brand';
import { flag } from '@/lib/country';
import { clearSavedCache } from '@/lib/hooks';
import { canInstallIosProfile, IOS_PROFILE_PATH, isIosSafari } from '@/lib/install';
import { useI18n } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { unregisterPush } from '@/lib/push';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

export default function SettingsScreen() {
  const { signOut } = useClerk();
  const supabase = useSupabase();
  const { c } = useTheme();
  const { t } = useI18n();
  const { profile } = useProfile();

  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '';
  const build = Application.nativeBuildVersion;
  const who = { everyone: 'Everyone', followers: 'People I follow', nobody: 'No one' }[profile?.who_can_message ?? 'everyone'];

  // Clears screens saved on this phone and cached pictures; sign-in and settings are kept.
  const cleanCache = () =>
    confirmAction('Clean cache?', 'Saved screens and pictures are removed from this device and load again from the internet. You stay signed in.', 'Clean', async () => {
      await Promise.all([clearSavedCache(), Image.clearDiskCache(), Image.clearMemoryCache()]).catch(() => {});
      Alert.alert('Cache cleaned', 'Screens and pictures will load fresh.');
    });


  // Downloads the install profile; iOS then asks to allow it and to finish in Settings.
  const installOnIphone = () => {
    if (!isIosSafari()) return Alert.alert(t('settings.installIphone'), t('settings.installIphone.safari'));
    window.location.href = IOS_PROFILE_PATH;
    setTimeout(() => Alert.alert(t('settings.installIphone'), t('settings.installIphone.steps')), 800);
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

        {canInstallIosProfile() && (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.violetSurface }}>
              <Ionicons name="phone-portrait-outline" size={22} color={c.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="h3">{t('settings.installIphone')}</Text>
              <Text variant="caption" muted>{t('settings.installIphone.body')}</Text>
            </View>
            <Button title={t('settings.installIphone.button')} size="sm" onPress={installOnIphone} />
          </Card>
        )}

        <Section title="Account">
          <ListRow icon="person-outline" label="Edit profile" onPress={() => router.push('/profile-edit')} />
          <ListRow icon="shield-checkmark-outline" label="Account management" onPress={() => router.push('/account')} />
          <ListRow icon="lock-closed-outline" label="Privacy" value={`Messages: ${who}`} onPress={() => router.push('/privacy-settings')} />
          <ListRow icon="ban-outline" label="Blocked accounts" onPress={() => router.push('/blocked')} />
          <ListRow icon="notifications-outline" label="Notifications" onPress={() => router.push('/notification-settings')} last />
        </Section>

        <Section title="About">
          <ListRow icon="document-text-outline" label="Terms of Service" onPress={() => router.push('/terms')} />
          <ListRow icon="lock-closed-outline" label={t('settings.privacy')} onPress={() => router.push('/privacy')} />
          <ListRow icon="help-circle-outline" label="Help & feedback" onPress={() => router.push('/support')} />
          <ListRow icon="information-circle-outline" label={`About ${brand.name}`} onPress={() => void WebBrowser.openBrowserAsync(`${brand.website.replace(/\/$/, '')}/about`)} />
          <ListRow icon="trash-bin-outline" label="Clean cache" onPress={cleanCache} last />
        </Section>

        <Button title={t('settings.signOut')} variant="secondary" style={{ backgroundColor: c.surfaceRaised, borderColor: c.violetBorder }}
          onPress={() => confirmAction(t('settings.signOut'), 'You can sign back in any time.', t('settings.signOut'), () => void unregisterPush(supabase).then(() => signOut()).then(() => router.replace('/')))} />
        <Button title={t('settings.delete')} variant="ghost" onPress={() => router.push('/delete-account')} style={{ marginTop: -8 }} icon={<Ionicons name="trash-outline" size={16} color={c.danger} />} />
        <Text variant="caption" faint style={{ textAlign: 'center' }}>{brand.name} {version}{build ? ` (${build})` : ''}</Text>
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
