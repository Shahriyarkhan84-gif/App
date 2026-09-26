import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { categoryLabel, displayName, type Room } from '@/lib/types';

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
      onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: room.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Watch ${name} live: ${room.title}`}
      style={{ height: 96, borderRadius: radius[16] + 2, overflow: 'hidden' }}
    >
      {room.cover_url ? (
        <Image source={room.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={4} />
      ) : (
        <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.65)']} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 }}>
        <View style={{ width: 60, height: 76, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surfaceRaised }}>
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
            style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: following ? 'rgba(255,255,255,0.22)' : '#fff' }}
          >
            <Text variant="label" color={following ? '#fff' : c.primary} style={{ fontSize: 12, fontWeight: '800' }}>{following ? 'Following' : 'Follow'}</Text>
          </PressScale>
        )}
      </View>
    </PressScale>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{children}</View>;
}
