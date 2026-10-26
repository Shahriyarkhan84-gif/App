import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { Card, ListRow, Row, Screen, Segmented, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { brand } from '@/lib/brand';
import { friendlyError } from '@/lib/errors';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { Profile } from '@/lib/types';

type WhoCanMessage = NonNullable<Profile['who_can_message']>;
const WHO: readonly { id: WhoCanMessage; label: string }[] = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'followers', label: 'People I follow' },
  { id: 'nobody', label: 'No one' },
];

/** Settings → Privacy: who can message you, Nearby visibility, and blocked accounts. */
export default function PrivacySettingsScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const { profile, reload } = useProfile();
  const [saving, setSaving] = useState(false);
  const who = profile?.who_can_message ?? 'everyone';
  const hidden = !!profile?.hide_from_nearby;

  const save = async (patch: Partial<Pick<Profile, 'who_can_message' | 'hide_from_nearby'>>) => {
    if (!profile || saving) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id);
    setSaving(false);
    if (error) return Alert.alert('Could not save', friendlyError(error));
    await reload();
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <View style={{ gap: 8 }}>
          <Text variant="h3">Who can message me</Text>
          <Segmented options={WHO} value={who} onChange={(v) => void save({ who_can_message: v })} />
          <Text variant="caption" muted>
            {who === 'everyone' ? 'Anyone can send you a message.' : who === 'followers' ? 'Only people you follow can message you.' : 'Nobody can message you. Existing chats stay, but no new messages arrive.'}
          </Text>
        </View>

        <Card style={{ padding: 16 }}>
          <Row style={{ alignItems: 'center' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label">Hide my lives from Nearby</Text>
              <Text variant="caption" muted>{"People in your country won't find your lives in the Nearby feed. They still show in Popular and to your followers."}</Text>
            </View>
            <Switch value={hidden} onValueChange={(v) => void save({ hide_from_nearby: v })} disabled={saving}
              trackColor={{ true: c.primary, false: c.divider }} thumbColor="#FFFFFF" accessibilityLabel="Hide my lives from Nearby" />
          </Row>
        </Card>

        <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          <ListRow icon="ban-outline" label="Blocked accounts" onPress={() => router.push('/blocked')} last />
        </Card>
        <Text variant="caption" faint>{`Blocked people can't message you or see you in Following on ${brand.name}.`}</Text>
      </ScrollView>
    </Screen>
  );
}
