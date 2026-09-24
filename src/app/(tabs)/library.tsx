import { useAuth } from '@clerk/clerk-expo';
import { FlatList, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PosterCard } from '@/components/PosterCard';
import { EmptyState, ErrorState, Loading } from '@/components/States';
import { useFocusedAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { colors, spacing } from '@/lib/theme';
import type { Video } from '@/lib/types';

export default function LibraryScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { width } = useWindowDimensions();
  const columns = Math.max(3, Math.floor(width / 140));
  const cardWidth = (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase
      .from('watchlist')
      .select('created_at, videos(*)')
      .eq('user_id', userId!)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as unknown as { videos: Video | null }[]).flatMap((row) => (row.videos ? [row.videos] : []));
  }, [userId]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>My List</Text>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState title="Your list is empty" body="Tap “My List” on any title to save it for later." />
      ) : (
        <FlatList
          key={columns}
          data={data}
          numColumns={columns}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
          columnWrapperStyle={{ gap: spacing.md }}
          renderItem={({ item }) => <PosterCard video={item} width={cardWidth} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
});
