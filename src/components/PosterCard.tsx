import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/lib/theme';
import type { Video } from '@/lib/types';

type Props = { video: Video; width?: number; progress?: number };

export function PosterCard({ video, width = 120, progress }: Props) {
  return (
    <Link href={{ pathname: '/title/[id]', params: { id: video.id } }} asChild>
      <Pressable style={{ width }} accessibilityLabel={video.title}>
        <View style={[styles.poster, { width, height: width * 1.5 }]}>
          <Image source={video.poster_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          {video.is_premium && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>PREMIUM</Text>
            </View>
          )}
          {progress !== undefined && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(100, progress * 100)}%` }]} />
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={styles.title}>
          {video.title}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  poster: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  badge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    backgroundColor: colors.premium,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: { color: '#1A1300', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: '#0008' },
  progressFill: { height: 4, backgroundColor: colors.accent },
  title: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
});
