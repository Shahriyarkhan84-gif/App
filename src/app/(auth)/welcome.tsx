import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PENDING_TASK_MESSAGE, SocialButtons } from '@/components/AuthForm';
import { Float, FadeIn } from '@/components/Motion';
import { Button, SkyBackground, Text } from '@/components/ui';
import { brand } from '@/lib/brand';
import { fonts, useTheme } from '@/lib/theme';

/**
 * First screen after the loading page (Glass & sky): the brand mark on the sky background, a blue
 * "Create account" button, a frosted "I have an account", then Google/Apple.
 */
export default function WelcomeScreen() {
  const { c } = useTheme();
  // sso-callback.tsx bounces here with ?notice=sso_timeout when Google/Apple
  // sign-in opened the browser but never came back with a session, so the
  // reason is visible instead of the screen just quietly resetting.
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [error, setError] = useState<string | null>(
    notice === 'sso_timeout' ? "Sign-in didn't finish. Please try again." : notice === 'pending_task' ? PENDING_TASK_MESSAGE : null,
  );
  return (
    <SkyBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 72, paddingBottom: 24, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
          <View style={{ gap: 14 }}>
            <FadeIn from={-16}>
              <Float>
                <View style={{ width: 92, height: 92, borderRadius: 28, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Image source={require('../../../assets/splash-icon.png')} style={{ width: 72, height: 72 }} contentFit="contain" accessible={false} />
                </View>
              </Float>
            </FadeIn>
            <FadeIn delay={300}>
              <Text accessibilityRole="header" accessibilityLabel={brand.name} color={c.text} style={{ fontFamily: fonts.brand, fontSize: 48, lineHeight: 56 }}>
                {brand.wordmark[0]}<Text color={c.primary} style={{ fontFamily: fonts.brand, fontSize: 48, lineHeight: 56 }}>{brand.wordmark[1]}</Text>
              </Text>
            </FadeIn>
            <FadeIn delay={420}>
              <Text muted style={{ fontSize: 20, lineHeight: 28, fontFamily: fonts.medium }}>{brand.tagline}</Text>
            </FadeIn>
          </View>
          <View style={{ flex: 1, minHeight: 40 }} />
          <View style={{ gap: 12 }}>
            <FadeIn delay={600}>
              <Button title="Create account" onPress={() => router.push('/sign-up')} style={{ minHeight: 56 }} />
            </FadeIn>
            <FadeIn delay={690}>
              <Button title="I have an account" variant="secondary" onPress={() => router.push('/sign-in')} style={{ minHeight: 56, backgroundColor: c.surface, borderColor: c.border }} />
            </FadeIn>
            <FadeIn delay={780} style={{ gap: 12 }}>
              <SocialButtons onError={setError} divider={false} />
              {error && (
                <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 14, backgroundColor: c.surfaceRaised }}>
                  <Text color={c.danger}>{error}</Text>
                </View>
              )}
            </FadeIn>
          </View>
          <FadeIn delay={870}>
            <Text variant="caption" faint style={{ textAlign: 'center', marginTop: 24, lineHeight: 18 }}>
              By continuing you agree to the{' '}
              <Text variant="caption" color={c.primary} style={{ fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push('/terms')}>Terms</Text>
              {' '}and{' '}
              <Text variant="caption" color={c.primary} style={{ fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push('/privacy')}>Privacy Policy</Text>
              . You must be 18+ to go live.
            </Text>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </SkyBackground>
  );
}
