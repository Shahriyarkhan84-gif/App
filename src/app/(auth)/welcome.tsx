import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthHero, AuthTerms, FormError, OrDivider, SocialButtons } from '@/components/AuthForm';
import { FadeIn } from '@/components/Motion';
import { Button } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/** First screen after the loading page: sign up, sign in, or continue with Google. */
export default function WelcomeScreen() {
  const { c } = useTheme();
  const [error, setError] = useState<string | null>(null);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 24, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
        <AuthHero />
        <View style={{ flex: 1, minHeight: 32 }} />
        <View style={{ gap: 12 }}>
          <FadeIn delay={650}><Button title="Create account" onPress={() => router.push('/sign-up')} /></FadeIn>
          <FadeIn delay={740}><Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} /></FadeIn>
          <FadeIn delay={830} style={{ gap: 12 }}>
            <OrDivider />
            <SocialButtons onError={setError} divider={false} />
            <FormError message={error} />
          </FadeIn>
        </View>
        <FadeIn delay={920}><AuthTerms /></FadeIn>
      </ScrollView>
    </SafeAreaView>
  );
}
