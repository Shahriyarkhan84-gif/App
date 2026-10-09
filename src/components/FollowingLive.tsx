import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { displayName, type Room, roomHref } from '@/lib/types';

import { Pop, PressScale, stagger } from './Motion';
import { Avatar, Button, Row, Sheet, Text } from './ui';

const SIZE = 64;

/** Avatar with a solid sky ring and a LIVE tag — shown whenever someone is live. */
export function LiveAvatar({ uri, name, size }: { uri?: string | null; name: string; size: number }) {
  const { c } = useTheme();
  const ring = Math.max(2, Math.round(size / 28));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: size / 2, borderWidth: ring, borderColor: c.primary }}>
      <Avatar uri={uri} name={name} size={size - ring * 2 - 4} />
      <View style={{ position: 'absolute', bottom: -7, paddingHorizontal: size > 80 ? 8 : 5, paddingVertical: 1, borderRadius: 4, backgroundColor: c.primary, borderWidth: 2, borderColor: c.background }}>
        <Text variant="caption" color={c.primaryText} style={{ fontSize: size > 80 ? 11 : 9, lineHeight: size > 80 ? 14 : 12, fontWeight: '700', letterSpacing: 0.5 }}>LIVE</Text>
      </View>
    </View>
  );
}

/** Stories-style row: people you follow who are live now. */
export function FollowingLive({ rooms, header = true, onOpen, inset = 20 }: { rooms: Room[]; header?: boolean; onOpen?: () => void; inset?: number }) {
  if (rooms.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      {header && (
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: inset }}>
          <Text variant="label">Following · live now</Text>
          <Text variant="caption" faint>{rooms.length} live</Text>
        </Row>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: header ? inset : 4, paddingVertical: 10 }}>
        {rooms.map((r, i) => {
          const name = displayName(r.host);
          return (
            // Keyed by room so a host who just went live pops in on their own.
            <Pop key={r.id} delay={stagger(i, 70)} from={0.3}>
              <PressScale
                scaleTo={0.92}
                onPress={() => {
                  onOpen?.();
                  router.push(roomHref(r));
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
        onPress={() => (count > 0 ? setOpen(true) : router.push({ pathname: '/messages', params: { tab: 'notifications' } }))}
        scaleTo={0.9}
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? `Notifications. ${count} people you follow are live` : 'Notifications'}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="notifications-outline" size={24} color={c.text} />
        {count > 0 && (
          // Re-keyed on count so the badge pops each time another host goes live.
          <Pop key={count} from={0.3} style={{ position: 'absolute', top: 2, right: 0 }}>
            <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: c.primary, borderWidth: 2, borderColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="caption" color={c.primaryText} style={{ fontSize: 10, lineHeight: 12, fontWeight: '700' }}>{count}</Text>
            </View>
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
            router.push({ pathname: '/messages', params: { tab: 'notifications' } });
          }}
        />
      </Sheet>
    </>
  );
}

/**
 * "Your Loop" strip at the top of Home (design canvas): your own ring first — tap it to go
 * live — then everyone you follow who is live right now. Always shown, even when nobody is live.
 */
export function LoopStrip({ me, rooms }: { me: { avatar_url?: string | null; name: string }; rooms: Room[] }) {
  const { c } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4 }}>
      <PressScale
        scaleTo={0.92}
        onPress={() => router.push('/create')}
        accessibilityRole="button"
        accessibilityLabel="Your Loop. Go live"
        style={{ width: 60, alignItems: 'center', gap: 4 }}
      >
        <View>
          <Avatar uri={me.avatar_url} name={me.name} size={56} ring={c.border} />
          <View style={{ position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: c.primary, borderWidth: 2, borderColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={13} color={c.primaryText} />
          </View>
        </View>
        <Text variant="caption" muted numberOfLines={1} style={{ fontSize: 11 }}>Your Loop</Text>
      </PressScale>
      {rooms.map((r, i) => {
        const name = displayName(r.host);
        return (
          <Pop key={r.id} delay={stagger(i, 70)} from={0.3}>
            <PressScale
              scaleTo={0.92}
              onPress={() => router.push(roomHref(r))}
              accessibilityRole="button"
              accessibilityLabel={`${name} is live. Watch`}
              style={{ width: 60, alignItems: 'center', gap: 4 }}
            >
              <Avatar uri={r.host?.avatar_url} name={name} size={56} ring={c.primary} />
              <Text variant="caption" muted numberOfLines={1} style={{ fontSize: 11 }}>{name}</Text>
            </PressScale>
          </Pop>
        );
      })}
    </ScrollView>
  );
}
