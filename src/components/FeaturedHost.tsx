import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSupabase } from '@/lib/supabase';
import { liveColors, useTheme } from '@/lib/theme';
import { categoryLabel, displayName, type Room, roomHref } from '@/lib/types';

import { PressScale } from './Motion';
import { LiveBadge, Text } from './ui';

/**
 * Spotlight card for the single most-watched live room right now — real
 * viewer-count ranking, not curated/fabricated content.
 */
export function FeaturedHost({ room, following: initialFollowing }: { room: Room; following: boolean }) {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c, radius } = useTheme();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const name = displayName(room.host);

  const toggleFollow = async () => {
    if (busy || room.host_id === userId) return;
    const next = !following;
    setFollowing(next);
    setBusy(true);
    const { error } = next
      ? await supabase.from('follows').insert({ followee_id: room.host_id })
      : await supabase.from('follows').delete().eq('follower_id', userId!).eq('followee_id', room.host_id);
    if (error) setFollowing(!next);
    setBusy(false);
  };

  return (
    <PressScale
      scaleTo={0.98}
      onPress={() => router.push(roomHref(room))}
      accessibilityRole="button"
      accessibilityLabel={`Watch ${name} live: ${room.title}`}
      style={{ height: 96, borderRadius: radius[12], overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider }}
    >
      {room.cover_url ? (
        <Image source={room.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={4} />
      ) : null}
      {room.cover_url && <LinearGradient colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 }}>
        <View style={{ width: 60, height: 72, borderRadius: 8, overflow: 'hidden', backgroundColor: liveColors.surfaceRaised }}>
          {room.host?.avatar_url ? (
            <Image source={room.host.avatar_url} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="display" color="rgba(255,255,255,0.35)" style={{ fontSize: 30 }}>{name.replace('@', '').slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Row2>
            <Text variant="label" color="#fff" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{name}</Text>
            <LiveBadge />
          </Row2>
          <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1}>{room.title} · {categoryLabel(room.category)}</Text>
        </View>
        {room.host_id !== userId && (
          <PressScale
            onPress={toggleFollow}
            accessibilityRole="button"
            accessibilityState={{ selected: following }}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: following ? 'transparent' : c.primary, borderWidth: 1, borderColor: following ? c.border : c.primary }}
          >
            <Text variant="label" color={following ? c.textMuted : c.primaryText} style={{ fontSize: 13, fontWeight: '700' }}>{following ? 'Following' : 'Follow'}</Text>
          </PressScale>
        )}
      </View>
    </PressScale>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{children}</View>;
}
