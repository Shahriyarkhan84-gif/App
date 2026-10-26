import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { PressScale } from '@/components/Motion';
import { compactNumber, Text } from '@/components/ui';
import { useAsync } from '@/lib/hooks';
import { fetchMediaBase, formatDuration, MEDIA_SELECT, mediaUrl, type MediaAsset } from '@/lib/media';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

/**
 * A person's videos on their social profile, three to a row: uploads or live replays.
 * Others see public, ready videos; the owner also sees unlisted ones.
 */
export function ProfileMedia({ userId, kind, isMe }: { userId: string; kind: MediaAsset['source_kind']; isMe: boolean }) {
  const supabase = useSupabase();
  const { c, radius } = useTheme();
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from('media_assets').select(MEDIA_SELECT).eq('owner_id', userId).eq('source_kind', kind).eq('status', 'ready');
    if (!isMe) q = q.eq('visibility', 'public');
    const [base, list] = await Promise.all([fetchMediaBase(supabase), q.order('published_at', { ascending: false }).limit(60)]);
    if (list.error) throw list.error;
    return { base, videos: (list.data ?? []) as MediaAsset[] };
  }, [userId, kind, isMe], `profile-media:${userId}:${kind}`);

  if (loading && !data) return <ActivityIndicator color={c.primary} style={{ paddingVertical: 32 }} />;
  if (error && !data) {
    return (
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 28 }}>
        <Text muted>Couldn&apos;t load videos.</Text>
        <Pressable onPress={reload} accessibilityRole="button" hitSlop={8}><Text variant="label" color={c.primary}>Try again</Text></Pressable>
      </View>
    );
  }
  const videos = data?.videos ?? [];
  if (videos.length === 0) {
    return (
      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 32 }}>
        <Ionicons name={kind === 'upload' ? 'film-outline' : 'radio-outline'} size={30} color={c.textFaint} />
        <Text muted>{kind === 'upload' ? (isMe ? 'Your videos show up here.' : 'No videos yet.') : 'No live replays yet.'}</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {videos.map((v) => {
        const thumb = mediaUrl(data?.base ?? null, v.thumbnail_path);
        return (
          <PressScale key={v.id} onPress={() => router.push({ pathname: '/videos/[id]', params: { id: v.id } })} accessibilityRole="button" accessibilityLabel={v.title}
            style={{ width: '32.6%', aspectRatio: 3 / 4, borderRadius: radius[12], overflow: 'hidden', backgroundColor: c.violetSurface }}>
            {thumb ? <Image source={thumb} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="film-outline" size={24} color={c.textFaint} /></View>
            )}
            <View style={{ position: 'absolute', left: 6, bottom: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="play" size={11} color="#fff" />
              <Text variant="caption" color="#fff" style={{ fontWeight: '700', flex: 1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 }}>{compactNumber(v.view_count)}</Text>
              {!!v.duration_ms && <Text variant="caption" color="#fff" style={{ fontSize: 10, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 }}>{formatDuration(v.duration_ms)}</Text>}
            </View>
          </PressScale>
        );
      })}
    </View>
  );
}
