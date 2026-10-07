import { useEvent, useEventListener } from 'expo';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView, type SubtitleTrack, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { OverflowMenu, type MenuItem } from '@/components/Menus';
import { resolveState, StateView, type ViewState } from '@/components/StateView';
import { Avatar, Chip, compactNumber, Row, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { rpc } from '@/lib/api';
import { env } from '@/lib/env';
import { friendlyError } from '@/lib/errors';
import { useAsync, useOffline } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { fetchMediaBase, mediaUrl, qualityBadge, type MediaAsset, type Rendition } from '@/lib/media';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

// The player is a native object configured imperatively (expo-video's API).
function selectSubtitleTrack(player: VideoPlayer, track: SubtitleTrack | null) {
  player.subtitleTrack = track;
}

/**
 * Plays a video's HLS master playlist. The player picks the variant: HDR
 * (VIDEO-RANGE=PQ/HLG) on HDR displays, the SDR ladder elsewhere, and adapts
 * bitrate to the network.
 */
export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supabase = useSupabase();
  const offline = useOffline();
  const { c, hPadding } = useTheme();
  const { profile, isPlatformAdmin } = useProfile();
  const { t } = useI18n();

  const { data, error, loading, reload } = useAsync(async () => {
    const [base, asset, renditions] = await Promise.all([
      fetchMediaBase(supabase),
      rpc<MediaAsset | null>(supabase, 'get_media', { p_asset_id: id }),
      supabase.from('media_renditions').select('label,width,height,dynamic_range').eq('asset_id', id),
    ]);
    if (!asset?.id) return { base, asset: null, renditions: [] as Rendition[], owner: null };
    const { data: owner } = await supabase.from('profiles').select('id,display_name,username,avatar_url').eq('id', asset.owner_id).maybeSingle();
    return { base, asset, renditions: (renditions.data ?? []) as Rendition[], owner };
  }, [id]);

  const src = data?.asset?.status === 'ready' ? mediaUrl(data.base, data.asset.playback_path) : null;
  const player = useVideoPlayer(src ? { uri: src, contentType: 'hls' } : null, (p) => {
    p.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  // AI subtitles arrive as HLS subtitle tracks; default to the viewer's language.
  const [tracks, setTracks] = useState(player.availableSubtitleTracks);
  const [caption, setCaption] = useState<string | null>(null);
  const autoPicked = useRef(false);
  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) => {
    setTracks(availableSubtitleTracks);
    if (autoPicked.current || !profile?.language) return;
    const mine = availableSubtitleTracks.find((t) => t.language.split('-')[0] === profile.language.split('-')[0]);
    if (mine) {
      autoPicked.current = true;
      selectSubtitleTrack(player, mine);
      setCaption(mine.language);
    }
  });
  const chooseCaption = (language: string | null) => {
    selectSubtitleTrack(player, tracks.find((t) => t.language === language) ?? null);
    setCaption(language);
  };

  useEffect(() => {
    if (src && profile) void rpc(supabase, 'record_media_view', { p_asset_id: id }).catch(() => undefined);
  }, [src, profile, id, supabase]);

  const asset = data?.asset;
  let state: ViewState = resolveState({ offline, loading, error, data, onRetry: reload });
  if (state.kind === 'success' && (!asset || asset.status === 'removed')) state = { kind: 'empty', title: t('videos.unavailable') };
  else if (state.kind === 'success' && asset?.status === 'failed') state = { kind: 'error', error: new Error('This video could not be processed. Upload it again from Your videos.') };
  else if (state.kind === 'success' && asset && asset.status !== 'ready') state = { kind: 'disabled', title: t('videos.processing'), body: t('videos.processing.body') };
  else if (state.kind === 'success' && !data?.base) state = { kind: 'disabled', title: 'Video unavailable', body: 'Videos can\'t be played right now. Please try again later.' };

  const canRemove = !!asset && (asset.owner_id === profile?.id || isPlatformAdmin);
  const badge = asset ? qualityBadge(asset, data?.renditions) : null;
  const aspect = asset?.width && asset.height ? Math.max(9 / 16, Math.min(16 / 9, asset.width / asset.height)) : 16 / 9;

  const remove = () =>
    Alert.alert(asset?.owner_id === profile?.id ? 'Delete this video?' : 'Take this video down?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await rpc(supabase, 'remove_media', { p_asset_id: id, p_reason: asset?.owner_id === profile?.id ? null : 'Removed by moderation' });
            router.back();
          } catch (e) {
            Alert.alert('Could not remove', friendlyError(e));
          }
        },
      },
    ]);

  const share = () => void Share.share({ message: `${asset?.title} ${env.siteUrl ? `${env.siteUrl}/videos/${id}` : ''}`.trim() });
  const actions: MenuItem[] = [
    { key: 'share', icon: 'share-social-outline', label: t('videos.share'), onPress: share },
    ...(canRemove ? [{ key: 'remove', icon: 'trash-outline' as const, label: t('videos.remove'), onPress: remove, destructive: true }] : []),
  ];

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: asset?.title ?? 'Video', headerRight: asset?.status === 'ready' ? () => <OverflowMenu actions={actions} /> : undefined }} />
      <StateView state={state}>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ width: '100%', aspectRatio: aspect, backgroundColor: '#000', maxHeight: 560 }}>
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} allowsPictureInPicture />
          </View>
          {status === 'error' && (
            <Text color={c.danger} style={{ padding: hPadding }}>{t('videos.cantPlay')}</Text>
          )}
          <View style={{ padding: hPadding, gap: 12 }}>
            <Row gap={8} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {badge && (
                <View style={{ backgroundColor: c.goldSurface, borderColor: c.goldBorder, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text variant="caption" color={c.goldText} style={{ fontWeight: '700' }}>{badge}</Text>
                </View>
              )}
              <Text variant="caption" muted>{t('videos.views', { count: compactNumber(asset?.view_count ?? 0) })}</Text>
              {asset?.source_kind === 'live_recording' && <Text variant="caption" muted>· {t('videos.replay')}</Text>}
            </Row>
            <Text variant="h2">{asset?.title}</Text>
            {!!asset?.description && <Text muted>{asset.description}</Text>}
            {data?.owner && (
              <Row gap={10} style={{ alignItems: 'center' }}>
                <Avatar uri={data.owner.avatar_url} name={displayName(data.owner)} size={36} />
                <Text style={{ flex: 1 }} onPress={() => router.push(`/user/${data.owner!.id}`)}>{displayName(data.owner)}</Text>
              </Row>
            )}
            {tracks.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text variant="caption" muted>{t('videos.captions')}</Text>
                <Row gap={8} style={{ flexWrap: 'wrap' }}>
                  <Chip label={t('videos.captions.off')} selected={caption === null} onPress={() => chooseCaption(null)} />
                  {tracks.map((t) => (
                    <Chip key={t.id ?? t.language} label={t.label || t.language} selected={caption === t.language} onPress={() => chooseCaption(t.language)} />
                  ))}
                </Row>
              </View>
            )}
          </View>
        </ScrollView>
      </StateView>
    </Screen>
  );
}
