import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { useFrameCatalog, type Frame } from '@/lib/frames';

import { Avatar, type IconName } from './ui';

/**
 * An avatar wearing a profile frame: a gradient ring with a soft glow and, for some frames, a
 * small badge on top. Pass `frame` directly (shop previews) or `frameId` (a profile's
 * active_frame_id, looked up in the cached catalog). No frame → the plain avatar with `ring`.
 */
export function FramedAvatar({ uri, name, size = 40, frame, frameId, ring }: {
  uri?: string | null; name?: string | null; size?: number; frame?: Frame | null; frameId?: string | null; ring?: string;
}) {
  const catalog = useFrameCatalog(!frame && !!frameId);
  const f = frame ?? (frameId ? catalog.data?.find((x) => x.id === frameId) : undefined);
  if (!f) return <Avatar uri={uri} name={name} size={size} ring={ring} />;

  const band = Math.max(3, Math.round(size / 14));
  const outer = size + band * 2;
  const badge = Math.max(16, Math.round(size / 3.2));
  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        position: 'absolute', width: outer, height: outer, borderRadius: outer / 2,
        shadowColor: f.style.glow, shadowOpacity: 0.8, shadowRadius: band * 2.5, shadowOffset: { width: 0, height: 0 }, elevation: 6,
        backgroundColor: f.style.glow,
      }} />
      <LinearGradient
        testID="frame-ring"
        colors={f.style.colors.length >= 2 ? (f.style.colors as [string, string, ...string[]]) : [f.style.glow, f.style.glow]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', width: outer, height: outer, borderRadius: outer / 2 }}
      />
      <Avatar uri={uri} name={name} size={size} />
      {f.style.icon && (
        <View style={{
          position: 'absolute', top: -badge * 0.35, alignSelf: 'center', width: badge, height: badge, borderRadius: badge / 2,
          alignItems: 'center', justifyContent: 'center', backgroundColor: f.style.colors[0], borderWidth: 2, borderColor: '#fff',
        }}>
          <Ionicons name={f.style.icon as IconName} size={badge * 0.6} color="#fff" />
        </View>
      )}
    </View>
  );
}
