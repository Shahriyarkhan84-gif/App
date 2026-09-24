import { useAuth } from '@clerk/clerk-expo';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Hero } from '@/components/Hero';
import { ErrorState, Loading } from '@/components/States';
import { VideoRow } from '@/components/VideoRow';
import { getRecommendations, getTrending } from '@/lib/api';
import { useAsync, useFocusedAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { colors, spacing } from '@/lib/theme';
import type { Video, WatchProgress } from '@/lib/types';

export default function HomeScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();

  const catalog = useAsync(async () => {
    const { data, error } = await supabase.from('videos').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data as Video[];
  }, []);

  const continueWatching = useFocusedAsync(async () => {
    const { data, error } = await supabase
      .from('watch_progress')
      .select('video_id,position_seconds,duration_seconds,updated_at,videos(*)')
      .eq('user_id', userId!)
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    // Hide titles that are basically finished.
    return (data as unknown as WatchProgress[]).filter(
      (p) => p.videos && p.duration_seconds > 0 && p.position_seconds / p.duration_seconds < 0.95,
    );
  }, [userId]);

  // Trending (Upstash) and recommendations (Pinecone) are optional extras:
  // if those services aren't configured the rows simply don't render.
  const trending = useAsync(() => getTrending(supabase).catch(() => [] as Video[]), []);
  const recs = useFocusedAsync(() => getRecommendations(supabase).catch(() => null), []);

  const byGenre = useMemo(() => {
    const groups = new Map<string, Video[]>();
    for (const video of catalog.data ?? []) {
      for (const genre of video.genres) groups.set(genre, [...(groups.get(genre) ?? []), video]);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [catalog.data]);

  if (catalog.loading && !catalog.data) return <Loading />;
  if (catalog.error) return <ErrorState error={catalog.error} onRetry={catalog.reload} />;

  const videos = catalog.data ?? [];
  const featured = videos.find((v) => v.featured) ?? videos[0];
  const progress = Object.fromEntries(
    (continueWatching.data ?? []).map((p) => [p.video_id, p.position_seconds / p.duration_seconds]),
  );

  const refresh = () => {
    catalog.reload();
    continueWatching.reload();
    trending.reload();
    recs.reload();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.text} />}
    >
      {featured ? <Hero video={featured} /> : <View style={{ height: insets.top + spacing.xl }} />}
      <View style={[styles.brandBar, { top: insets.top + spacing.sm }]} pointerEvents="none">
        <Text style={styles.brand}>STREAMLY</Text>
      </View>

      <VideoRow
        title="Continue watching"
        videos={(continueWatching.data ?? []).map((p) => p.videos!)}
        progress={progress}
      />
      <VideoRow title="Trending now" videos={trending.data ?? []} />
      {recs.data?.basedOn && <VideoRow title={`Because you watched ${recs.data.basedOn.title}`} videos={recs.data.videos} />}
      <VideoRow title="New releases" videos={videos.slice(0, 12)} />
      {byGenre.map(([genre, list]) => (
        <VideoRow key={genre} title={genre} videos={list} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  brandBar: { position: 'absolute', left: spacing.lg },
  brand: { color: colors.accent, fontSize: 22, fontWeight: '900', letterSpacing: 3 },
});
