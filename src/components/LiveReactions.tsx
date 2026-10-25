import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useSupabase } from '@/lib/supabase';

import { Text } from './ui';

// Likes (floating hearts) and "X joined" lines for a live room, sent over Supabase Realtime broadcast:
// display only, nothing is stored and nothing counts towards money or rankings.

const HEART_COLORS = ['#F48FB8', '#B488FF', '#E11D48', '#FFC24B', '#FF7AA2'];
const MAX_HEARTS = 14;

type Heart = { id: number; color: string; drift: number };

export function useLiveReactions(roomId: string | undefined, myName: string | null, announceJoin: boolean) {
  const supabase = useSupabase();
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [joined, setJoined] = useState<{ id: number; name: string } | null>(null);
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingLikes = useRef(0);
  const nextId = useRef(0);

  const addHearts = useCallback((n: number) => {
    setHearts((h) => {
      const add = Array.from({ length: Math.min(n, 4) }, () => ({
        id: nextId.current++,
        color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)],
        drift: Math.round((Math.random() - 0.5) * 50),
      }));
      return [...h, ...add].slice(-MAX_HEARTS);
    });
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const ch = supabase.channel(`live-reactions:${roomId}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'like' }, ({ payload }) => addHearts(Math.max(1, Math.min(Number(payload?.n) || 1, 4))))
      .on('broadcast', { event: 'joined' }, ({ payload }) => {
        const name = typeof payload?.name === 'string' ? payload.name.slice(0, 30) : '';
        if (name) setJoined({ id: nextId.current++, name });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && announceJoin && myName) void ch.send({ type: 'broadcast', event: 'joined', payload: { name: myName } });
      });
    channel.current = ch;
    // Taps are sent at most twice a second, however fast someone taps.
    const flush = setInterval(() => {
      if (pendingLikes.current > 0) {
        void ch.send({ type: 'broadcast', event: 'like', payload: { n: Math.min(pendingLikes.current, 4) } });
        pendingLikes.current = 0;
      }
    }, 500);
    return () => {
      clearInterval(flush);
      channel.current = null;
      void supabase.removeChannel(ch);
    };
    // Join is announced once per room; a name change mid-live doesn't re-announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, supabase, addHearts]);

  // The "joined" line fades after a few seconds.
  useEffect(() => {
    if (!joined) return;
    const t = setTimeout(() => setJoined((j) => (j?.id === joined.id ? null : j)), 3500);
    return () => clearTimeout(t);
  }, [joined]);

  const like = useCallback(() => {
    pendingLikes.current += 1;
    addHearts(1);
  }, [addHearts]);
  const removeHeart = useCallback((id: number) => setHearts((h) => h.filter((x) => x.id !== id)), []);

  return { hearts, joined, like, removeHeart };
}

/** Hearts rising up the right side of the video. */
export function FloatingHearts({ hearts, onDone, bottom }: { hearts: Heart[]; onDone: (id: number) => void; bottom: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 18, bottom, width: 60, height: 260 }}>
      {hearts.map((h) => <RisingHeart key={h.id} heart={h} onDone={onDone} />)}
    </View>
  );
}

function RisingHeart({ heart, onDone }: { heart: Heart; onDone: (id: number) => void }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start(() => onDone(heart.id));
    return () => anim.stop();
  }, [t, heart.id, onDone]);
  return (
    <Animated.View style={{
      position: 'absolute', bottom: 0, right: 14,
      opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.9, 0] }),
      transform: [
        { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -240] }) },
        { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, heart.drift, heart.drift / 2] }) },
        { scale: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.4, 1.1, 0.9] }) },
      ],
    }}>
      <Ionicons name="heart" size={28} color={heart.color} />
    </Animated.View>
  );
}

/** "✨ Name joined" line above the chat. */
export function JoinedLine({ joined }: { joined: { id: number; name: string } | null }) {
  if (!joined) return null;
  return (
    <View key={joined.id} accessibilityLiveRegion="polite" style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(180,136,255,0.38)' }}>
      <Text variant="caption" color="#fff" style={{ fontWeight: '600' }}>✨ {joined.name} joined the live</Text>
    </View>
  );
}
