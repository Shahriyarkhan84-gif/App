import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { categoryLabel, displayName, type Room } from '@/lib/types';

import { LiveBadge, Text, ViewerCount } from './ui';

export function RoomCard({ room, width, reason }: { room: Room; width: number; reason?: string | null }) {
  const { c, radius } = useTheme();
  const cover = room.cover_url ?? room.host?.avatar_url;
  const name = displayName(room.host);
  return (
    <Link href={{ pathname: '/live/[roomId]', params: { roomId: room.id } }} asChild>
      <Pressable style={{ width }} accessibilityLabel={`Watch ${name} live: ${room.title}`}>
        <View style={{ width, height: Math.round(width * 1.33), borderRadius: radius[16], overflow: 'hidden', backgroundColor: c.surfaceRaised }}>
          {cover ? <Image source={cover} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="display" color="rgba(255,255,255,0.14)" style={{ fontSize: 96, lineHeight: 110 }}>{name.replace('@', '').slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
            <LiveBadge />
            <ViewerCount count={room.viewer_count} />
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 28, paddingBottom: 12, experimental_backgroundImage: 'linear-gradient(transparent, rgba(0,0,0,0.72))' }}>
            <Text variant="label" color="#fff" style={{ fontSize: 15 }} numberOfLines={1}>{name}</Text>
            <Text variant="caption" color="#E4DFEC" numberOfLines={1}>{room.title} · {categoryLabel(room.category)}</Text>
          </View>
        </View>
        {reason && <Text variant="caption" faint numberOfLines={1} style={{ marginTop: 4 }}>{reason}</Text>}
      </Pressable>
    </Link>
  );
}
