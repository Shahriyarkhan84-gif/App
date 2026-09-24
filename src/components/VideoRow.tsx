import { FlatList, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/lib/theme';
import type { Video } from '@/lib/types';

import { PosterCard } from './PosterCard';

type Props = { title: string; videos: Video[]; progress?: Record<string, number> };

export function VideoRow({ title, videos, progress }: Props) {
  if (videos.length === 0) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={videos}
        keyExtractor={(v) => v.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
        renderItem={({ item }) => <PosterCard video={item} progress={progress?.[item.id]} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.xl },
  heading: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
});
