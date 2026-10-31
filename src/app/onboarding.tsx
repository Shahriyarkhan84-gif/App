import { LinearGradient } from 'expo-linear-gradient';
import { useClerk } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeIn } from '@/components/Motion';
import { Button, Card, Chip, Input, Row, SkyBackground, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { parseBirthDate } from '@/lib/age';
import { brand, U } from '@/lib/brand';
import { friendlyError } from '@/lib/errors';
import { useProfile } from '@/lib/profile';
import { unregisterPush } from '@/lib/push';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { CATEGORIES, categoryLabel, type Category } from '@/lib/types';

/**
 * Shown once after sign-up (and once to existing accounts): birthday, then interests.
 * The server decides adult/minor from the date and restricts under-18s everywhere; this
 * screen only tells them why.
 */
export default function OnboardingScreen() {
  const supabase = useSupabase();
  const { profile, reload } = useProfile();
  const { signOut } = useClerk();
  const { c } = useTheme();
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [picked, setPicked] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Interests come right after the birthday (or straight away for someone who already gave one).
  const [step, setStep] = useState<'birthday' | 'interests'>(profile?.age_check === 'adult' ? 'interests' : 'birthday');

  const minor = profile?.age_check === 'minor';
  const date = parseBirthDate(day, month, year);

  const saveBirthday = async () => {
    if (!date) return setError('Enter a real date, for example 14 / 08 / 1999.');
    setBusy(true);
    setError(null);
    try {
      await rpc(supabase, 'set_birth_date', { p_birth_date: date });
      await reload();
      setStep('interests');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (cat: Category) => setPicked((p) => (p.includes(cat) ? p.filter((x) => x !== cat) : [...p, cat]));
  const finish = async (save: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (save && picked.length > 0 && profile) {
        const { error: e } = await supabase.from('profiles').update({ interests: picked }).eq('id', profile.id);
        if (e) throw e;
        await reload();
      }
      router.replace('/');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SkyBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 520, width: '100%', alignSelf: 'center', flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <FadeIn>
            {minor ? (
              <Card style={{ padding: 22, gap: 12, borderRadius: 28 }}>
                <Ionicons name="hand-left-outline" size={32} color={c.primary} />
                <Text variant="h2" accessibilityRole="header">{`${brand.name} is for adults`}</Text>
                <Text muted>{`You need to be 18 or older to use ${brand.name}. Your account can't go live, send gifts, message or buy ${U.spend}.`}</Text>
                <Text variant="caption" faint>If you entered the wrong date, contact support from the website.</Text>
                <Button title="Sign out" variant="secondary" onPress={() => void unregisterPush(supabase).then(() => signOut()).then(() => router.replace('/'))} />
              </Card>
            ) : step === 'birthday' ? (
              <View style={{ gap: 14 }}>
                <StepBar step={1} />
                <Text variant="display" accessibilityRole="header">When is your birthday?</Text>
                <Text muted>{`${brand.name} is for people 18 and over. Your birthday isn't shown to anyone.`}</Text>
                <Row gap={10}>
                  <View style={{ flex: 1 }}><Input label="Day" placeholder="DD" keyboardType="number-pad" maxLength={2} value={day} onChangeText={setDay} /></View>
                  <View style={{ flex: 1 }}><Input label="Month" placeholder="MM" keyboardType="number-pad" maxLength={2} value={month} onChangeText={setMonth} /></View>
                  <View style={{ flex: 1.4 }}><Input label="Year" placeholder="YYYY" keyboardType="number-pad" maxLength={4} value={year} onChangeText={setYear} /></View>
                </Row>
                <Text variant="caption" faint>You can&apos;t change this later, so check it&apos;s right.</Text>
                {error && <Text variant="caption" color={c.danger} accessibilityRole="alert">{error}</Text>}
                <Button title="Continue" onPress={() => void saveBirthday()} loading={busy} disabled={year.length < 4 || !day || !month} />
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                <StepBar step={2} />
                <Text variant="display" accessibilityRole="header">What do you love watching?</Text>
                <Text muted>Pick a few. Lives you&apos;ll like come first on Discover.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CATEGORIES.map((cat) => <Chip key={cat} label={categoryLabel(cat)} selected={picked.includes(cat)} onPress={() => toggle(cat)} />)}
                </View>
                {error && <Text variant="caption" color={c.danger} accessibilityRole="alert">{error}</Text>}
                <Button title={picked.length ? `Continue (${picked.length})` : 'Continue'} onPress={() => void finish(true)} loading={busy} disabled={picked.length === 0} />
                <Button title="Skip for now" variant="ghost" onPress={() => void finish(false)} disabled={busy} />
              </View>
            )}
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </SkyBackground>
  );
}

/** "Step n of 2" over a cyan-to-violet progress bar (Aurora dark onboarding). */
function StepBar({ step }: { step: 1 | 2 }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 8 }} accessibilityLabel={`Step ${step} of 2`}>
      <Text variant="caption" color={c.primary} style={{ fontWeight: '700' }}>Step {step} of 2</Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.divider, overflow: 'hidden' }}>
        <LinearGradient colors={c.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: step === 1 ? '50%' : '100%', height: '100%' }} />
      </View>
    </View>
  );
}
