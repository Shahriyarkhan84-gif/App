import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { displayName, type Room } from '@/lib/types';

import { Pop, PressScale, Pulse, Ripple, Spin, stagger } from './Motion';
import { Avatar, Button, Row, Sheet, Text } from './ui';

const SIZE = 64;

/** Avatar with a spinning ring, outward ripples and a pulsing LIVE tag — shown whenever someone is live. */
export function LiveAvatar({ uri, name, size }: { uri?: string | null; name: string; size: number }) {
  const { c } = useTheme();
  const ring = Math.max(3, Math.round(size / 24));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ripple size={size} color={c.primary} period={1600} ring />
      <Ripple size={size} color={c.primary} period={1600} delay={800} ring />
      <Spin style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: ring, borderTopColor: c.primary, borderRightColor: c.gold, borderBottomColor: c.accent, borderLeftColor: c.primary }} />
      <Avatar uri={uri} name={name} size={size - ring * 2 - 6} />
      <View style={{ position: 'absolute', bottom: -8 }}>
        <Pulse min={1} max={1.1} period={1200}>
          <View style={{ paddingHorizontal: size > 80 ? 8 : 6, paddingVertical: 1, borderRadius: 5, backgroundColor: c.primary, borderWidth: 2, borderColor: c.background }}>
            <Text variant="caption" color="#fff" style={{ fontSize: size > 80 ? 11 : 9, lineHeight: size > 80 ? 14 : 12, fontWeight: '800', letterSpacing: 0.6 }}>LIVE</Text>
          </View>
        </Pulse>
      </View>
    </View>
  );
}

/** TikTok-style row: people you follow who are live now, with a spinning ring that ripples outward. */
export function FollowingLive({ rooms, header = true, onOpen }: { rooms: Room[]; header?: boolean; onOpen?: () => void }) {
  if (rooms.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      {header && (
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20 }}>
          <Text variant="label">Following · live now</Text>
          <Text variant="caption" faint>{rooms.length} live</Text>
        </Row>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingHorizontal: header ? 20 : 4, paddingVertical: 10 }}>
        {rooms.map((r, i) => {
          const name = displayName(r.host);
          return (
            // Keyed by room so a host who just went live pops in on their own.
            <Pop key={r.id} delay={stagger(i, 70)} from={0.3}>
              <PressScale
                scaleTo={0.92}
                onPress={() => {
                  onOpen?.();
                  router.push({ pathname: '/live/[roomId]', params: { roomId: r.id } });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${name} is live. Watch`}
                style={{ width: 72, alignItems: 'center', gap: 10 }}
              >
                <LiveAvatar uri={r.host?.avatar_url} name={name} size={SIZE} />
                <Text variant="caption" muted numberOfLines={1}>{name}</Text>
              </PressScale>
            </Pop>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Home bell: a pulsing count of followed hosts who are live; opens their live rings. */
export function LiveBell({ rooms }: { rooms: Room[] }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const count = rooms.length;
  return (
    <>
      <PressScale
        onPress={() => (count > 0 ? setOpen(true) : router.push('/messages'))}
        scaleTo={0.9}
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? `Notifications. ${count} people you follow are live` : 'Notifications'}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}
      >
        {count > 0 && <Ripple size={44} color={c.primary} period={1800} ring />}
        <Ionicons name="notifications-outline" size={20} color={c.text} />
        {count > 0 && (
          // Re-keyed on count so the badge pops each time another host goes live.
          <Pop key={count} from={0.3} style={{ position: 'absolute', top: 2, right: 0 }}>
            <Pulse min={1} max={1.15} period={1400}>
              <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: c.primary, borderWidth: 2, borderColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" color="#fff" style={{ fontSize: 10, lineHeight: 12, fontWeight: '800' }}>{count}</Text>
              </View>
            </Pulse>
          </Pop>
        )}
      </PressScale>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Following · live now">
        <FollowingLive rooms={rooms} header={false} onOpen={() => setOpen(false)} />
        <Button
          title="All notifications"
          variant="secondary"
          onPress={() => {
            setOpen(false);
            router.push('/messages');
          }}
        />
      </Sheet>
    </>
  );
}
