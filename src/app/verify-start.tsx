import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { useStartVerification } from '@/components/HostVerificationCard';
import { FadeIn, Float } from '@/components/Motion';
import { Button, Card, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

const logo = require('../../assets/logo.png');

/** "Starting with Didit": hand-off screen before the secure Didit verification page opens. */
export default function VerifyStartScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const { isHost, reload } = useProfile();
  const [agreed, setAgreed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // When the user comes back from Didit, refresh their status and return to Hosting.
  const { start, busy } = useStartVerification(() => {
    void reload();
    router.back();
  });

  const onContinue = async () => {
    // First verification also creates the host record (Host ID = user ID).
    if (!isHost) {
      setPreparing(true);
      try {
        await rpc(supabase, 'become_host');
        track('became_host', {});
        await reload();
      } catch (e) {
        Alert.alert('Could not continue', friendlyError(e));
        return;
      } finally {
        setPreparing(false);
      }
    }
    await start();
  };

  const working = preparing || busy;

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 20, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <FadeIn style={{ alignItems: 'center', gap: 14, paddingTop: 12 }}>
          <Row gap={14}>
            <Float offset={0}>
              <ImageTile />
            </Float>
            <Ionicons name="swap-horizontal" size={22} color={c.textFaint} />
            <Float offset={400}>
              <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="shield-checkmark" size={30} color={c.success} />
              </View>
            </Float>
          </Row>
          <Text variant="h1" style={{ textAlign: 'center' }} accessibilityRole="header">Starting with Didit</Text>
          <Text muted style={{ textAlign: 'center' }}>
            You’ll continue on Didit’s secure page to scan your ID and take a quick selfie. It takes about 2 minutes, then you’ll come straight back here.
          </Text>
        </FadeIn>

        <FadeIn delay={120}>
          <Card style={{ gap: 12 }}>
            <Point icon="lock-closed-outline" text="Your ID photos and selfie go to Didit only — Zynalive never sees them." />
            <Point icon="checkmark-done-outline" text="We only receive the result: approved or not." />
            <Point icon="time-outline" text="Most results arrive in minutes. We’ll notify you." />
          </Card>
        </FadeIn>

        <FadeIn delay={200}>
          <Pressable
            onPress={() => setAgreed((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 }}
          >
            <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: agreed ? c.primary : c.border, backgroundColor: agreed ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              {agreed && <Ionicons name="checkmark" size={16} color="#fff" />}
            </View>
            <Text style={{ flex: 1 }}>
              I agree to Didit processing my ID document and selfie to verify my identity for hosting on Zynalive.{' '}
              <Text color={c.primary} accessibilityRole="link" onPress={() => router.push('/privacy')}>Privacy policy</Text>
            </Text>
          </Pressable>
        </FadeIn>

        <View style={{ flex: 1 }} />

        <FadeIn delay={260} style={{ gap: 10 }}>
          <Button
            title={preparing ? 'Getting ready…' : busy ? 'Opening Didit…' : 'Continue to Didit'}
            onPress={onContinue}
            loading={working}
            disabled={!agreed || offline}
            icon={<Ionicons name="open-outline" size={18} color={c.primaryText} />}
          />
          <Button title="Not now" variant="ghost" onPress={() => router.back()} disabled={working} />
          {offline && <Text variant="caption" muted style={{ textAlign: 'center' }}>You need a connection to continue.</Text>}
        </FadeIn>
      </ScrollView>
    </Screen>
  );
}

function ImageTile() {
  return <Image source={logo} style={{ width: 64, height: 64 }} contentFit="contain" accessibilityLabel="Zynalive" />;
}

function Point({ icon, text }: { icon: 'lock-closed-outline' | 'checkmark-done-outline' | 'time-outline'; text: string }) {
  const { c } = useTheme();
  return (
    <Row gap={10} style={{ alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={20} color={c.gold} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1 }}>{text}</Text>
    </Row>
  );
}
