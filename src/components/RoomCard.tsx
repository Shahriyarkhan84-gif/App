import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { displayName, type Room } from '@/lib/types';

import { Avatar, LiveBadge, Text } from './ui';

export function RoomCard({ room, width, reason }: { room: Room; width: number; reason?: string | null }) {
  const { c, radius } = useTheme();
  const cover = room.cover_url ?? room.host?.avatar_url;
  return (
    <Link href={{ pathname: '/live/[roomId]', params: { roomId: room.id } }} asChild>
      <Pressable style={{ width }} accessibilityLabel={`${displayName(room.host)} live: ${room.title}`}>
        <View style={{ width, height: width * 1.33, borderRadius: radius[16], overflow: 'hidden', backgroundColor: c.surfaceRaised }}>
          {cover ? <Image source={cover} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Avatar name={displayName(room.host)} size={56} />
            </View>
          )}
          <View style={{ position: 'absolute', top: 8, left: 8 }}>
            <LiveBadge viewers={room.viewer_count} />
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8, backgroundColor: 'rgba(0,0,0,0.45)' }}>
            <Text variant="label" color="#fff" numberOfLines={1}>{room.title}</Text>
            <Text variant="caption" color="#ddd" numberOfLines={1}>{displayName(room.host)}{room.host?.country ? ` · ${room.host.country}` : ''}</Text>
          </View>
        </View>
        {reason && <Text variant="caption" muted numberOfLines={1} style={{ marginTop: 4 }}>{reason}</Text>}
      </Pressable>
    </Link>
  );
}
