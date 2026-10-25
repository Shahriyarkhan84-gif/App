import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PENDING_TASK_MESSAGE, SocialButtons } from '@/components/AuthForm';
import { Float, FadeIn, PressScale } from '@/components/Motion';
import { Text } from '@/components/ui';
import { fonts, useTheme } from '@/lib/theme';

/**
 * First screen after the loading page (Redesign v2): full violet hero, white "Create account",
 * outlined "I have an account", then Google/Apple. Everything on the gradient is white text (4.8:1+).
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
    <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 72, paddingBottom: 24, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
          <View style={{ gap: 14 }}>
            <FadeIn from={-16}>
              <Float>
                <View style={{ width: 92, height: 92, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                  <Image source={require('../../../assets/splash-icon.png')} style={{ width: 72, height: 72 }} contentFit="contain" accessible={false} />
                </View>
              </Float>
            </FadeIn>
            <FadeIn delay={300}>
              <Text accessibilityRole="header" color="#fff" style={{ fontFamily: fonts.brand, fontSize: 48, lineHeight: 56 }}>zynalive</Text>
            </FadeIn>
            <FadeIn delay={420}>
              <Text color="#fff" style={{ fontSize: 20, lineHeight: 28, fontFamily: fonts.medium, opacity: 0.95 }}>
                Go live. Make friends.{'\n'}Support the hosts you love.
              </Text>
            </FadeIn>
          </View>
          <View style={{ flex: 1, minHeight: 40 }} />
          <View style={{ gap: 12 }}>
            <FadeIn delay={600}>
              <PressScale onPress={() => router.push('/sign-up')} accessibilityRole="button" accessibilityLabel="Create account"
                style={{ minHeight: 54, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="label" color={c.primary} style={{ fontSize: 17 }}>Create account</Text>
              </PressScale>
            </FadeIn>
            <FadeIn delay={690}>
              <PressScale onPress={() => router.push('/sign-in')} accessibilityRole="button" accessibilityLabel="I have an account"
                style={{ minHeight: 54, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="label" color="#fff" style={{ fontSize: 17 }}>I have an account</Text>
              </PressScale>
            </FadeIn>
            <FadeIn delay={780} style={{ gap: 12 }}>
              <SocialButtons onError={setError} divider={false} />
              {error && (
                <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 14, backgroundColor: '#fff' }}>
                  <Text color={c.danger}>{error}</Text>
                </View>
              )}
            </FadeIn>
          </View>
          <FadeIn delay={870}>
            <Text variant="caption" color="#fff" style={{ textAlign: 'center', marginTop: 24, lineHeight: 18, opacity: 0.9 }}>
              By continuing you agree to the{' '}
              <Text variant="caption" color="#fff" style={{ textDecorationLine: 'underline', fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push('/terms')}>Terms</Text>
              {' '}and{' '}
              <Text variant="caption" color="#fff" style={{ textDecorationLine: 'underline', fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push('/privacy')}>Privacy Policy</Text>
              . You must be 18+ to go live.
            </Text>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}
