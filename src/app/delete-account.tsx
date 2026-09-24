import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, Input, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { deleteAccount } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

const REMOVED = ['Your name, username, photo, bio and email', 'Followers, following and blocks', 'Direct messages and notifications', 'Your live chat messages (replaced with “[deleted]”)'];
const KEPT = ['Purchase, gift and payout records (required by law)', 'Reports and moderation history'];

export default function DeleteAccountScreen() {
  const supabase = useSupabase();
  const { signOut } = useClerk();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(supabase);
      track('account_deleted', {});
      await signOut();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <Text variant="h2">Delete your account</Text>
          <Text muted>This is permanent. You won’t be able to sign in again with this account, and unused coins and unpaid earnings are lost.</Text>
        </View>
        <Card>
          <Text variant="label">We delete</Text>
          {REMOVED.map((t) => <Item key={t} icon="trash-outline" color={c.danger} text={t} />)}
        </Card>
        <Card>
          <Text variant="label">We keep</Text>
          {KEPT.map((t) => <Item key={t} icon="document-lock-outline" color={c.textMuted} text={t} />)}
          <Text variant="caption" faint>Identity documents from host verification are held by Didit under their retention policy.</Text>
        </Card>
        <Input label='Type DELETE to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
        {error && <Text color={c.danger}>{error}</Text>}
        <Button title="Delete my account" variant="danger" loading={busy} disabled={confirm.trim() !== 'DELETE' || offline} onPress={onDelete} />
        {offline && <Text variant="caption" muted>You need a connection to delete your account.</Text>}
      </ScrollView>
    </Screen>
  );
}

function Item({ icon, color, text }: { icon: 'trash-outline' | 'document-lock-outline'; color: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={color} style={{ marginTop: 2 }} />
      <Text style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}
