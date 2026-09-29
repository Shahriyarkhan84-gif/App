import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { PressScale } from '@/components/Motion';
import { compactNumber, Text } from '@/components/ui';
import { formatDuration, mediaUrl, qualityBadge, STATUS_LABEL, type MediaAsset } from '@/lib/media';
import { useTheme } from '@/lib/theme';

/** Thumbnail tile for a video; shows processing status to its owner. */
export function VideoCard({ asset, base, onPress, showStatus }: { asset: MediaAsset; base: string | null; onPress: () => void; showStatus?: boolean }) {
  const { c, radius } = useTheme();
  const thumb = mediaUrl(base, asset.thumbnail_path);
  const badge = asset.status === 'ready' ? qualityBadge(asset) : null;
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={asset.title} style={{ flex: 1, gap: 6 }}>
      <View style={{ aspectRatio: 16 / 9, borderRadius: radius[12], overflow: 'hidden', backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
        {thumb ? (
          <Image source={thumb} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Ionicons name="film-outline" size={28} color={c.textFaint} />
        )}
        {badge && (
          <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: c.overlay, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text variant="caption" color={c.gold} style={{ fontWeight: '700' }}>{badge}</Text>
          </View>
        )}
        {!!asset.duration_ms && (
          <View style={{ position: 'absolute', bottom: 6, right: 6, backgroundColor: c.overlay, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text variant="caption" color="#fff">{formatDuration(asset.duration_ms)}</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={{ fontWeight: '600' }}>{asset.title}</Text>
      {showStatus && asset.status !== 'ready' ? (
        <Text variant="caption" color={asset.status === 'failed' ? c.danger : c.textMuted}>{STATUS_LABEL[asset.status]}</Text>
      ) : (
        <Text variant="caption" muted>{compactNumber(asset.view_count)} views{asset.source_kind === 'live_recording' ? ' · Replay' : ''}</Text>
      )}
    </PressScale>
  );
}
