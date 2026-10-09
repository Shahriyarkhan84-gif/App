import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { View } from 'react-native';

import { flag } from '@/lib/country';
import { liveColors, useTheme } from '@/lib/theme';
import { categoryLabel, displayName, type Room, roomHref } from '@/lib/types';

import { PressScale } from './Motion';
import { compactNumber, RoleBadges, Text } from './ui';

/**
 * Live-app grid card (Bigo/Tango style): full-bleed cover, a small LIVE / PK / Party tag top-left,
 * TOP rank top-right, and name + flag + viewers over a dark fade at the bottom.
 */
export function RoomCard({ room, width, reason, rank }: { room: Room; width: number; reason?: string | null; rank?: number }) {
  const { c, radius } = useTheme();
  const cover = room.cover_url ?? room.host?.avatar_url;
  const name = displayName(room.host);
  const country = room.host?.country;
  const tag = room.current_battle_id ? 'PK' : room.mode === 'voice' || room.mode === 'video' ? 'Party' : 'LIVE';
  return (
    <Link href={roomHref(room)} asChild>
      <PressScale style={{ width }} scaleTo={0.97} accessibilityLabel={`Watch ${name} live: ${room.title}. ${room.viewer_count} watching`}>
        <View style={{ width, height: Math.round(width * 1.25), borderRadius: radius[8], overflow: 'hidden', backgroundColor: liveColors.surfaceRaised }}>
          {cover ? <Image source={cover} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="display" color="rgba(255,255,255,0.12)" style={{ fontSize: 88, lineHeight: 100 }}>{name.replace('@', '').slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ position: 'absolute', top: 6, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, height: 20, borderRadius: 4, backgroundColor: tag === 'PK' ? c.gold : c.primary }}>
              {tag === 'LIVE' && <Bars color={c.primaryText} />}
              <Text variant="caption" color={tag === 'PK' ? c.onGold : c.primaryText} style={{ fontSize: 10, lineHeight: 12, fontWeight: '700', letterSpacing: 0.4 }}>{tag}</Text>
            </View>
            {rank !== undefined && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, paddingHorizontal: 6, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                <Ionicons name="trophy" size={10} color={c.gold} />
                <Text variant="caption" color={c.gold} style={{ fontSize: 10, lineHeight: 12, fontWeight: '700' }}>TOP {rank}</Text>
              </View>
            )}
          </View>
          {/* LinearGradient renders on every platform (CSS background images don't on web). */}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingTop: 36, paddingBottom: 8, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="label" color="#fff" style={{ fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{name}</Text>
              <RoleBadges profile={room.host} small />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {country ? <Text variant="caption" style={{ fontSize: 12 }}>{flag(country)}</Text> : null}
              <Text variant="caption" color="rgba(255,255,255,0.7)" numberOfLines={1} style={{ flex: 1 }}>{room.title || categoryLabel(room.category)}</Text>
              <Ionicons name="eye-outline" size={12} color="rgba(255,255,255,0.85)" />
              <Text variant="caption" color="rgba(255,255,255,0.85)" style={{ fontWeight: '700' }}>{compactNumber(room.viewer_count)}</Text>
            </View>
          </LinearGradient>
        </View>
        {reason && <Text variant="caption" faint numberOfLines={1} style={{ marginTop: 4 }}>{reason}</Text>}
      </PressScale>
    </Link>
  );
}

/** Static "sound bars" live mark used on cards (three bars, no animation). */
function Bars({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, height: 9 }}>
      {[5, 9, 6].map((h, i) => <View key={i} style={{ width: 2, height: h, borderRadius: 1, backgroundColor: color }} />)}
    </View>
  );
}
