import { useAuth } from '@clerk/clerk-expo';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/Button';
import { LinearGradientFallback } from '@/components/LinearGradientFallback';
import { ErrorState, Loading } from '@/components/States';
import { useAnalytics } from '@/lib/analytics';
import { formatDuration } from '@/lib/format';
import { useAsync, useSubscription } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import type { Video } from '@/lib/types';

export default function TitleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const track = useAnalytics();
  const { width } = useWindowDimensions();
  const { isSubscribed } = useSubscription();
  const [inListOverride, setInList] = useState<boolean | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const [video, list, progress] = await Promise.all([
      supabase.from('videos').select('*').eq('id', id).single(),
      supabase.from('watchlist').select('video_id').eq('user_id', userId!).eq('video_id', id).maybeSingle(),
      supabase.from('watch_progress').select('position_seconds').eq('user_id', userId!).eq('video_id', id).maybeSingle(),
    ]);
    if (video.error) throw video.error;
    return { video: video.data as Video, inList: !!list.data, position: progress.data?.position_seconds ?? 0 };
  }, [id, userId]);

  useEffect(() => {
    if (!data) return;
    track('video_opened', { video_id: data.video.id, title: data.video.title });
  }, [data, track]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState error={error ?? new Error('Not found')} onRetry={reload} />;

  const { video, position } = data;
  const inList = inListOverride ?? data.inList;
  const locked = video.is_premium && !isSubscribed;

  const toggleList = async () => {
    const next = !inList;
    setInList(next); // optimistic
    const { error } = next
      ? await supabase.from('watchlist').insert({ video_id: video.id })
      : await supabase.from('watchlist').delete().eq('user_id', userId!).eq('video_id', video.id);
    if (error) setInList(!next);
    else track('watchlist_toggled', { video_id: video.id, added: next });
  };

  const play = () => {
    if (locked) router.push({ pathname: '/paywall', params: { videoId: video.id } });
    else router.push({ pathname: '/watch/[id]', params: { id: video.id } });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <View style={{ height: Math.min(460, width * 0.9) }}>
        <Image source={video.backdrop_url} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradientFallback />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{video.title}</Text>
        <Text style={styles.meta}>
          {[video.release_year, video.maturity_rating, formatDuration(video.duration_seconds)].filter(Boolean).join('  •  ')}
          {video.is_premium ? '   ★ Premium' : ''}
        </Text>
        <Button title={locked ? 'Unlock with Premium' : position > 5 ? 'Resume' : 'Play'} icon={locked ? '🔒' : '▶'} onPress={play} />
        <Button title={inList ? 'In My List' : 'My List'} icon={inList ? '✓' : '+'} variant="secondary" onPress={toggleList} />
        <Text style={styles.description}>{video.description}</Text>
        <View style={styles.genres}>
          {video.genres.map((g) => (
            <Text key={g} style={styles.genre}>
              {g}
            </Text>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: spacing.lg, gap: spacing.md, marginTop: -spacing.xxl, maxWidth: 760, width: '100%', alignSelf: 'center' },
  title: { color: colors.text, fontSize: 30, fontWeight: '900' },
  meta: { color: colors.textMuted, fontSize: 14 },
  description: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: spacing.sm },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  genre: {
    color: colors.textMuted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    fontSize: 12,
  },
});
