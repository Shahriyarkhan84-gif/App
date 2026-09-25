import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { displayName, type Room } from '@/lib/types';

import { Pop, PressScale, Pulse, Ripple, Spin, stagger } from './Motion';
import { Avatar, Row, Text } from './ui';

const SIZE = 64;

/** TikTok-style row: people you follow who are live now, with a spinning ring that ripples outward. */
export function FollowingLive({ rooms }: { rooms: Room[] }) {
  const { c } = useTheme();
  if (rooms.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20 }}>
        <Text variant="label">Following · live now</Text>
        <Text variant="caption" faint>{rooms.length} live</Text>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingHorizontal: 20, paddingVertical: 10 }}>
        {rooms.map((r, i) => {
          const name = displayName(r.host);
          return (
            // Keyed by room so a host who just went live pops in on their own.
            <Pop key={r.id} delay={stagger(i, 70)} from={0.3}>
              <PressScale
                scaleTo={0.92}
                onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: r.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${name} is live. Watch`}
                style={{ width: 72, alignItems: 'center', gap: 10 }}
              >
                <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
                  <Ripple size={SIZE} color={c.primary} period={1600} ring />
                  <Ripple size={SIZE} color={c.primary} period={1600} delay={800} ring />
                  <Spin style={{ position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 3, borderTopColor: c.primary, borderRightColor: c.gold, borderBottomColor: '#FF6B85', borderLeftColor: c.primary }} />
                  <Avatar uri={r.host?.avatar_url} name={name} size={SIZE - 10} />
                  <View style={{ position: 'absolute', bottom: -8 }}>
                    <Pulse min={1} max={1.1} period={1200}>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: c.primary, borderWidth: 2, borderColor: c.background }}>
                        <Text variant="caption" color="#fff" style={{ fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 0.6 }}>LIVE</Text>
                      </View>
                    </Pulse>
                  </View>
                </View>
                <Text variant="caption" muted numberOfLines={1}>{name}</Text>
              </PressScale>
            </Pop>
          );
        })}
      </ScrollView>
    </View>
  );
}
