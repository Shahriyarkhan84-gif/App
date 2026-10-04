import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { liveColors as c } from '@/lib/theme';

import { Avatar, Text } from './ui';

export type PartyMode = 'voice' | 'video';

/** One seat on the party stage: seat 0 is the host, 1…N are guests, `user` null is an empty seat. */
export type Seat = {
  seat: number;
  user: { id: string; name: string; avatar_url?: string | null } | null;
  muted?: boolean;
};

type Props = {
  mode: PartyMode;
  seats: Seat[];
  speaking: Set<string>;
  /** Video tile for a user, or null when their camera isn't on (video parties only). */
  renderVideo?: (userId: string) => ReactNode | null;
  onSeatPress?: (seat: Seat) => void;
};

/**
 * Party stage seats from the design canvas: a host seat plus a 4-wide grid of
 * guest circles (voice) or a 2-wide grid of video tiles (video). Speaking seats
 * get a glowing ring; empty seats show a "+" to ask for that seat.
 */
export function PartySeats({ mode, seats, speaking, renderVideo, onSeatPress }: Props) {
  if (mode === 'video') {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {seats.map((s) => {
          const talking = !!s.user && speaking.has(s.user.id);
          const video = s.user && renderVideo ? renderVideo(s.user.id) : null;
          return (
            <Pressable
              key={s.seat}
              onPress={() => onSeatPress?.(s)}
              accessibilityRole="button"
              accessibilityLabel={s.user ? `${s.user.name}${s.seat === 0 ? ', host' : ''}` : `Empty seat ${s.seat}`}
              style={{
                width: '49%', aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: c.surfaceRaised,
                borderWidth: 2, borderColor: talking ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {video ?? (s.user ? <Avatar uri={s.user.avatar_url} name={s.user.name} size={64} /> : <Ionicons name="add" size={28} color={c.textMuted} />)}
              {s.user && (
                <View style={{ position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {s.seat === 0 && <Ionicons name="star" size={12} color={c.gold} />}
                  <Text variant="caption" color="#fff" numberOfLines={1} style={{ flex: 1, fontWeight: '700' }}>{s.user.name}</Text>
                  {s.muted && <Ionicons name="mic-off" size={14} color="#fff" />}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  }

  const [host, ...guests] = seats;
  return (
    <View style={{ gap: 18, alignItems: 'center' }}>
      {host && <VoiceSeat seat={host} big talking={!!host.user && speaking.has(host.user.id)} onPress={onSeatPress} />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, width: '100%' }}>
        {guests.map((s) => (
          <View key={s.seat} style={{ width: '25%', alignItems: 'center' }}>
            <VoiceSeat seat={s} talking={!!s.user && speaking.has(s.user.id)} onPress={onSeatPress} />
          </View>
        ))}
      </View>
    </View>
  );
}

function VoiceSeat({ seat, big, talking, onPress }: { seat: Seat; big?: boolean; talking: boolean; onPress?: (s: Seat) => void }) {
  const size = big ? 84 : 60;
  return (
    <Pressable
      onPress={() => onPress?.(seat)}
      accessibilityRole="button"
      accessibilityLabel={seat.user ? `${seat.user.name}${big ? ', host' : ''}${talking ? ', speaking' : ''}` : `Empty seat ${seat.seat}`}
      style={{ alignItems: 'center', gap: 6, width: size + 16 }}
    >
      <View style={{ width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, borderWidth: 3, borderColor: talking ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {seat.user ? (
          <Avatar uri={seat.user.avatar_url} name={seat.user.name} size={size} ring={big ? c.gold : undefined} />
        ) : (
          <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={22} color={c.textMuted} />
          </View>
        )}
        {seat.user && seat.muted && (
          <View style={{ position: 'absolute', right: 0, bottom: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="mic-off" size={11} color="#fff" />
          </View>
        )}
      </View>
      <Text variant="caption" color={seat.user ? c.text : c.textMuted} numberOfLines={1} style={{ fontSize: 11, maxWidth: size + 16 }}>
        {seat.user ? seat.user.name : big ? 'Host' : `Seat ${seat.seat}`}
      </Text>
    </Pressable>
  );
}
