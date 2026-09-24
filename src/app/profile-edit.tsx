import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Input, Screen } from '@/components/ui';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';

export default function EditProfileScreen() {
  const supabase = useSupabase();
  const { profile, reload } = useProfile();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [country, setCountry] = useState(profile?.country ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameValid = !username || /^[a-z0-9_.]{3,24}$/.test(username);
  const countryValid = !country || /^[A-Z]{2}$/.test(country);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    // Only public fields are writable (column grants); role/status cannot be sent.
    const { error } = await supabase.from('profiles').update({
      display_name: displayName.trim() || null,
      username: username || null,
      bio: bio.trim() || null,
      country: country || null,
    }).eq('id', profile.id);
    setSaving(false);
    if (error) {
      setError(error.code === '23505' ? 'That username is taken.' : 'Could not save your profile.');
      return;
    }
    await reload();
    router.back();
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Input label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={50} />
        <Input label="Username" value={username} onChangeText={(t) => setUsername(t.toLowerCase())} autoCapitalize="none" error={usernameValid ? error : '3–24 letters, numbers, _ or .'} />
        <Input label="Bio" value={bio} onChangeText={setBio} maxLength={280} multiline style={{ minHeight: 80, paddingTop: 12 }} />
        <Input label="Country code" value={country} onChangeText={(t) => setCountry(t.toUpperCase().slice(0, 2))} placeholder="PK" autoCapitalize="characters" error={countryValid ? null : 'Two-letter code, e.g. PK, IN, BD'} />
        <Button title="Save" onPress={save} loading={saving} disabled={!usernameValid || !countryValid} />
      </ScrollView>
    </Screen>
  );
}
