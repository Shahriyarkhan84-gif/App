import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { Button, ListRow, Screen, Text } from '@/components/ui';
import { useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { signOut } = useClerk();
  const { c } = useTheme();

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Text variant="h1">Settings</Text>

        <ListRow icon="lock-closed-outline" label="Privacy policy" onPress={() => router.push('/privacy')} last />

        <Button title="Sign out" variant="ghost" onPress={() => signOut()} />
        <Button title="Delete account" variant="ghost" onPress={() => router.push('/delete-account')} style={{ marginTop: -8 }} icon={<Ionicons name="trash-outline" size={16} color={c.danger} />} />
      </ScrollView>
    </Screen>
  );
}
