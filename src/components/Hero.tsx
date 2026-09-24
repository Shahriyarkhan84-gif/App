import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { formatDuration } from '@/lib/format';
import { colors, spacing } from '@/lib/theme';
import type { Video } from '@/lib/types';

import { Button } from './Button';
import { LinearGradientFallback } from './LinearGradientFallback';

export function Hero({ video }: { video: Video }) {
  const { width } = useWindowDimensions();
  const height = Math.min(520, width * 1.1);

  return (
    <View style={{ height, marginBottom: spacing.xl }}>
      <Image source={video.backdrop_url} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradientFallback />
      <View style={styles.content}>
        <Text style={styles.title}>{video.title}</Text>
        <Text style={styles.meta}>
          {[video.release_year, video.maturity_rating, formatDuration(video.duration_seconds), video.genres.join(' · ')]
            .filter(Boolean)
            .join('  •  ')}
        </Text>
        <View style={styles.actions}>
          <Button
            title="Play"
            icon="▶"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/watch/[id]', params: { id: video.id } })}
          />
          <Button
            title="More info"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/title/[id]', params: { id: video.id } })}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: 34, fontWeight: '900' },
  meta: { color: colors.textMuted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
