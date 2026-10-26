import { useClerk, useUser } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { clerkErrorMessage } from '@/components/AuthForm';
import { Button, Card, Input, ListRow, Row, Screen, Text, type IconName } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useProfile } from '@/lib/profile';
import { useTheme } from '@/lib/theme';

const PROVIDERS: Record<string, { label: string; icon: IconName }> = {
  google: { label: 'Google', icon: 'logo-google' },
  apple: { label: 'Apple', icon: 'logo-apple' },
};

/** Settings → Account management: sign-in email, linked sign-ins, password, and delete account. */
export default function AccountScreen() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { profile } = useProfile();
  const { c } = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <Screen edges={['bottom']}><View /></Screen>;
  const hasPassword = user.passwordEnabled;
  const linked = user.externalAccounts.map((a) => ({ id: a.id, provider: a.provider.replace(/^oauth_/, ''), email: a.emailAddress }));

  const savePassword = async () => {
    setError(null);
    if (next.length < 8) return setError('Use at least 8 characters.');
    setSaving(true);
    try {
      await user.updatePassword({ newPassword: next, ...(hasPassword ? { currentPassword: current } : {}), signOutOfOtherSessions: true });
      setCurrent('');
      setNext('');
      Alert.alert(hasPassword ? 'Password changed' : 'Password set', 'Other devices have been signed out.');
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Card style={{ padding: 16, gap: 10 }}>
          <Text variant="caption" muted style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>Signed in as</Text>
          <Text variant="h3">{user.primaryEmailAddress?.emailAddress ?? user.primaryPhoneNumber?.phoneNumber ?? 'No email'}</Text>
          {profile && <Text variant="caption" faint>ID {profile.user_number} · member since {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</Text>}
        </Card>

        <View style={{ gap: 8 }}>
          <Text variant="caption" muted style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>Sign-in methods</Text>
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {linked.length === 0 && !hasPassword && <Text muted style={{ padding: 16 }}>Email code only.</Text>}
            {linked.map((a, i) => (
              <Row key={a.id} style={{ minHeight: 52, paddingHorizontal: 16, borderBottomWidth: i === linked.length - 1 && !hasPassword ? 0 : 1, borderBottomColor: c.divider }}>
                <Ionicons name={PROVIDERS[a.provider]?.icon ?? 'link-outline'} size={20} color={c.text} />
                <Text style={{ flex: 1 }}>{PROVIDERS[a.provider]?.label ?? a.provider}</Text>
                <Text variant="caption" muted numberOfLines={1} style={{ maxWidth: 180 }}>{a.email}</Text>
              </Row>
            ))}
            {hasPassword && (
              <Row style={{ minHeight: 52, paddingHorizontal: 16 }}>
                <Ionicons name="key-outline" size={20} color={c.text} />
                <Text style={{ flex: 1 }}>Email and password</Text>
                <Ionicons name="checkmark-circle" size={18} color={c.success} />
              </Row>
            )}
          </Card>
        </View>

        <Card style={{ padding: 16, gap: 10 }}>
          <Text variant="h3">{hasPassword ? 'Change password' : 'Set a password'}</Text>
          {!hasPassword && <Text variant="caption" muted>Add a password so you can also sign in with your email.</Text>}
          {hasPassword && <Input label="Current password" secureTextEntry autoComplete="current-password" value={current} onChangeText={setCurrent} />}
          <Input label="New password" secureTextEntry autoComplete="new-password" value={next} onChangeText={setNext} />
          {error && <Text variant="caption" color={c.danger}>{error}</Text>}
          <Button title={hasPassword ? 'Change password' : 'Set password'} onPress={() => void savePassword()} loading={saving} disabled={!next || (hasPassword && !current)} />
        </Card>

        <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          <ListRow icon="log-out-outline" label="Sign out" onPress={() => void signOut().then(() => router.replace('/'))} />
          <ListRow icon="trash-outline" label="Delete account" color={c.danger} onPress={() => router.push('/delete-account')} last />
        </Card>
      </ScrollView>
    </Screen>
  );
}
