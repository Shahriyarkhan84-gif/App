import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { Card, Row, Screen, Segmented, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
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

type Switchable = 'hide_location' | 'message_requests' | 'hide_from_nearby' | 'pk_invites_followers_only';
const SWITCHES: readonly { key: Switchable; title: string; body: string; default: boolean }[] = [
  { key: 'hide_location', title: 'Hide my location', body: 'Your country and flag won\'t show on your profile or your live card.', default: false },
  { key: 'message_requests', title: 'Message requests', body: 'Messages from people you don\'t follow go to a separate "Message requests" folder in Messages.', default: true },
  { key: 'hide_from_nearby', title: 'Hide my lives from Nearby', body: 'People in your country won\'t find your lives in Nearby. They still show in Popular and to your followers.', default: false },
  { key: 'pk_invites_followers_only', title: 'PK invites only from people I follow', body: 'Other hosts can only challenge you to a PK battle if you follow them.', default: false },
];

/** Settings → Privacy: who can message you, what others see, PK invites, and blocked accounts. */
export default function PrivacySettingsScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const { profile, reload } = useProfile();
  const [saving, setSaving] = useState(false);
  const who = profile?.who_can_message ?? 'everyone';

  const save = async (patch: Partial<Pick<Profile, 'who_can_message' | Switchable>>) => {
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

        <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          {SWITCHES.map((sw, i) => (
            <Row key={sw.key} style={{ padding: 16, borderBottomWidth: i === SWITCHES.length - 1 ? 0 : 1, borderBottomColor: c.divider }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label">{sw.title}</Text>
                <Text variant="caption" muted>{sw.body}</Text>
              </View>
              <Switch value={profile?.[sw.key] ?? sw.default} onValueChange={(v) => void save({ [sw.key]: v })} disabled={saving}
                trackColor={{ true: c.primary, false: c.divider }} thumbColor="#FFFFFF" accessibilityLabel={sw.title} />
            </Row>
          ))}
        </Card>

      </ScrollView>
    </Screen>
  );
}
