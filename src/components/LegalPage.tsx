import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

import { IconButton, Text, Wordmark } from './ui';

/** Public, signed-out-readable page (privacy policy, account deletion) — also served on the web. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {router.canGoBack() ? <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} /> : <View style={{ width: 44 }} />}
          <Wordmark size={22} />
          <View style={{ width: 44 }} />
        </View>
        <Text variant="h1" accessibilityRole="header">{title}</Text>
        <Text variant="caption" faint>Last updated {updated}</Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function H({ children }: { children: ReactNode }) {
  return <Text variant="h3" accessibilityRole="header" style={{ marginTop: 8 }}>{children}</Text>;
}

export function P({ children }: { children: ReactNode }) {
  return <Text muted style={{ lineHeight: 22 }}>{children}</Text>;
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ gap: 6 }}>
      {items.map((t) => (
        <View key={t} style={{ flexDirection: 'row', gap: 8 }}>
          <Text muted>•</Text>
          <Text muted style={{ flex: 1, lineHeight: 22 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}
