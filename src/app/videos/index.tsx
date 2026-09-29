import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Row, Screen, Text } from '@/components/ui';
import { VideoCard } from '@/components/VideoCard';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { fetchMediaBase, MEDIA_SELECT, type MediaAsset } from '@/lib/media';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

/** Public videos (uploads + live replays), newest first. */
export default function VideosScreen() {
  const supabase = useSupabase();
  const offline = useOffline();
  const { hPadding } = useTheme();
  const { isHost } = useProfile();

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const [base, list] = await Promise.all([
      fetchMediaBase(supabase),
      supabase.from('media_assets').select(MEDIA_SELECT).eq('status', 'ready').eq('visibility', 'public')
        .order('published_at', { ascending: false }).limit(60),
    ]);
    if (list.error) throw list.error;
    return { base, videos: (list.data ?? []) as MediaAsset[] };
  }, []);

  const state = resolveState({
    offline, loading, error, data, onRetry: reload,
    isEmpty: (d) => d.videos.length === 0,
    empty: isHost
      ? { title: 'No videos yet', body: 'Be the first to share one.', action: { title: 'Upload a video', onPress: () => router.push('/videos/upload') } }
      : { title: 'No videos yet', body: 'Hosts’ uploads and live replays show up here.' },
  });

  return (
    <Screen edges={[]}>
      {isHost && (
        <Row style={{ paddingHorizontal: hPadding, paddingVertical: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <Text muted>Uploads & live replays</Text>
          <Button title="My videos" size="sm" variant="secondary" onPress={() => router.push('/videos/upload')} />
        </Row>
      )}
      <StateView state={state}>
        <FlatList
          data={data?.videos ?? []}
          keyExtractor={(v) => v.id}
          numColumns={2}
          onRefresh={reload}
          refreshing={loading && !!data}
          contentContainerStyle={{ padding: hPadding, gap: 16 }}
          columnWrapperStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <View style={{ flex: 1 / 2 }}>
              <VideoCard asset={item} base={data?.base ?? null} onPress={() => router.push(`/videos/${item.id}`)} />
            </View>
          )}
        />
      </StateView>
    </Screen>
  );
}
