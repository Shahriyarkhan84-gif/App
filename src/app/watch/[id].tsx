import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Loading } from '@/components/States';
import { useAnalytics } from '@/lib/analytics';
import { trackView } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { Sentry } from '@/lib/sentry';
import { useSupabase } from '@/lib/supabase';
import { colors, spacing } from '@/lib/theme';

const SAVE_EVERY_SECONDS = 10;

export default function WatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();

  const { data, error, loading, reload } = useAsync(async () => {
    // `video_streams` is protected by RLS: premium stream URLs are only
    // readable by users with an active Stripe subscription.
    const [stream, video, progress] = await Promise.all([
      supabase.from('video_streams').select('hls_url').eq('video_id', id).maybeSingle(),
      supabase.from('videos').select('title,is_premium').eq('id', id).single(),
      supabase.from('watch_progress').select('position_seconds,duration_seconds').eq('user_id', userId!).eq('video_id', id).maybeSingle(),
    ]);
    if (video.error) throw video.error;
    if (stream.error) throw stream.error;
    const p = progress.data;
    // Start over if the title was (nearly) finished last time.
    const resumeAt = p && p.duration_seconds > 0 && p.position_seconds / p.duration_seconds < 0.95 ? p.position_seconds : 0;
    return { url: stream.data?.hls_url ?? null, title: video.data.title as string, isPremium: video.data.is_premium as boolean, resumeAt };
  }, [id, userId]);

  useEffect(() => {
    if (data && !data.url && data.isPremium) {
      router.replace({ pathname: '/paywall', params: { videoId: id } });
    }
  }, [data, id]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data?.url) return <Loading />;

  return <Player videoId={id} url={data.url} title={data.title} resumeAt={data.resumeAt} />;
}

function Player({ videoId, url, title, resumeAt }: { videoId: string; url: string; title: string; resumeAt: number }) {
  const supabase = useSupabase();
  const track = useAnalytics();
  const insets = useSafeAreaInsets();
  const lastSaved = useRef(0);

  const player = useVideoPlayer({ uri: url, metadata: { title } }, (p) => {
    p.timeUpdateEventInterval = 1;
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = true;
    if (resumeAt > 0) p.currentTime = resumeAt;
    p.play();
  });

  useEffect(() => {
    const save = (position: number) => {
      const duration = player.duration;
      if (!duration || !Number.isFinite(duration)) return;
      lastSaved.current = position;
      supabase
        .from('watch_progress')
        .upsert(
          { video_id: videoId, position_seconds: Math.floor(position), duration_seconds: Math.floor(duration), updated_at: new Date().toISOString() },
          { onConflict: 'user_id,video_id' },
        )
        .then(({ error }) => error && Sentry.captureException(error));
    };

    trackView(supabase, videoId);
    track('video_started', { video_id: videoId, resumed_from: resumeAt });

    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (Math.abs(currentTime - lastSaved.current) >= SAVE_EVERY_SECONDS) save(currentTime);
    });
    const endSub = player.addListener('playToEnd', () => {
      save(player.duration);
      track('video_completed', { video_id: videoId });
    });
    const statusSub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error' && error) Sentry.captureMessage(`Playback error: ${error.message}`, { extra: { videoId, url } });
    });

    return () => {
      timeSub.remove();
      endSub.remove();
      statusSub.remove();
      try {
        save(player.currentTime);
      } catch {
        // Player may already be released.
      }
    };
  }, [player, supabase, videoId, resumeAt, track, url]);

  return (
    <View style={styles.screen}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
        allowsPictureInPicture
        fullscreenOptions={{ enable: true }}
      />
      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <Pressable accessibilityLabel="Close player" onPress={() => router.back()} style={styles.close} hitSlop={12}>
          <Ionicons name="chevron-down" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
});
