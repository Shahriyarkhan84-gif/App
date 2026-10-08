import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useWindowDimensions, View } from 'react-native';

import { getLiveKitToken, rpc } from '@/lib/api';
import { errorCode } from '@/lib/errors';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName, normalizeRoom, ROOM_SELECT, type PkBattle, type Room } from '@/lib/types';

import { OpponentStage } from './LiveStage';
import { Avatar, Row, Text } from './ui';

/** Minimum height of the split-video block (small phones). */
export const PK_SPLIT_HEIGHT = 300;

/** The split takes ~58% of the screen so the two videos fill it instead of leaving it half black. */
export function usePkSplitHeight() {
  const { height } = useWindowDimensions();
  return Math.round(Math.min(Math.max(height * 0.58, PK_SPLIT_HEIGHT), 620));
}

/**
 * Live state of a battle a room is currently in (`rooms.current_battle_id`).
 * Works for both the host's own room and a viewer's watched room — pass
 * whichever room the screen already has, plus its `current_battle_id`.
 */
export function usePkBattleState(myRoomId: string | undefined, battleId: string | null | undefined) {
  const supabase = useSupabase();
  // Realtime updates (score/status) layer on top of the initial fetch; keyed
  // by battleId so a stale override from a previous battle never leaks in.
  const [override, setOverride] = useState<PkBattle | null>(null);

  const fetched = useAsync(async () => {
    if (!battleId) return null;
    const { data, error } = await supabase.from('pk_battles').select('*').eq('id', battleId).single();
    if (error) throw error;
    return data as PkBattle;
  }, [battleId]);
  useRealtime('pk_battles', battleId ? `id=eq.${battleId}` : undefined, (p) => setOverride(p.new as PkBattle), !!battleId);

  const battle = override && override.id === battleId ? override : (fetched.data ?? null);

  const opponentRoomId = battle && myRoomId ? (battle.room_a_id === myRoomId ? battle.room_b_id : battle.room_a_id) : null;
  const opponent = useAsync(async () => {
    if (!opponentRoomId) return null;
    const { data, error } = await supabase.from('rooms').select(ROOM_SELECT).eq('id', opponentRoomId).single();
    if (error) throw error;
    return normalizeRoom(data as never);
  }, [opponentRoomId]);

  const mySide: 'a' | 'b' | null = battle && myRoomId ? (battle.room_a_id === myRoomId ? 'a' : 'b') : null;

  // A ticking clock, updated only from the interval callback (not synchronously
  // in the effect body), so seconds-left is a plain derived value each render.
  const [now, setNow] = useState(() => Date.now());
  const live = battle?.status === 'live' && !!battle.ends_at;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const secondsLeft = live ? Math.max(0, Math.ceil((new Date(battle!.ends_at!).getTime() - now) / 1000)) : null;

  return { battle, opponentRoom: opponent.data ?? null, mySide, secondsLeft };
}

/** The opponent's live video feed, read-only — one half of the split. */
function OpponentPane({ opponentRoom }: { opponentRoom: Room }) {
  const supabase = useSupabase();
  const token = useAsync(() => getLiveKitToken(supabase, opponentRoom.id, 'viewer'), [opponentRoom.id]);

  if (!token.data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1030' }}>
        <Avatar uri={opponentRoom.host?.avatar_url} name={displayName(opponentRoom.host)} size={44} />
      </View>
    );
  }
  return (
    <OpponentStage url={token.data.url} token={token.data.token} />
  );
}

/**
 * Full split-screen battle stage: my own live video (left/right, passed in
 * since the host/viewer screen already owns that LiveKitRoom connection) next
 * to the opponent's, a VS badge between them, and the score/timer bar below.
 * Neither host's video changes — each keeps publishing to their own room;
 * this only composes two existing viewer-safe streams side by side.
 */
export function PkBattleStage({ mySide, myStage, opponentRoom, mySideLabel, opponentSideLabel, height }: {
  mySide: 'a' | 'b' | null;
  myStage: ReactNode;
  opponentRoom: Room;
  mySideLabel: string;
  opponentSideLabel: string;
  /** Override the split height (the viewer room keeps room for chat under the videos). */
  height?: number;
}) {
  const leftIsMe = mySide !== 'b';
  const defaultHeight = usePkSplitHeight();
  const splitHeight = height ?? defaultHeight;
  return (
    <View style={{ height: splitHeight, flexDirection: 'row', backgroundColor: '#000' }}>
      <View style={{ flex: 1, overflow: 'hidden' }}>{leftIsMe ? myStage : <OpponentPane opponentRoom={opponentRoom} />}</View>
      <View style={{ flex: 1, overflow: 'hidden' }}>{leftIsMe ? <OpponentPane opponentRoom={opponentRoom} /> : myStage}</View>
      <Row gap={0} style={{ position: 'absolute', left: 0, right: 0, bottom: 6, justifyContent: 'space-between', paddingHorizontal: 10 }}>
        <Text variant="caption" color="#fff" numberOfLines={1} style={{ maxWidth: '46%', fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
          {leftIsMe ? mySideLabel : opponentSideLabel}
        </Text>
        <Text variant="caption" color="#fff" numberOfLines={1} style={{ maxWidth: '46%', fontWeight: '700', textAlign: 'right', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
          {leftIsMe ? opponentSideLabel : mySideLabel}
        </Text>
      </Row>
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} />
    </View>
  );
}

/**
 * Battle score bar: a thick two-colour bar across the screen (my side sky blue, the opponent gold,
 * split by score) with both scores, a glowing seam where they meet and a "PK 4:36" timer tab.
 * `timerBelow` hangs the tab under the bar so it overlaps the top of the videos.
 */
export function PkBattleBar({ battle, mySide, secondsLeft, timerBelow = true }: { battle: PkBattle; mySide: 'a' | 'b' | null; secondsLeft: number | null; timerBelow?: boolean }) {
  const scoreLeft = mySide === 'b' ? battle.score_b : battle.score_a;
  const scoreRight = mySide === 'b' ? battle.score_a : battle.score_b;
  const total = scoreLeft + scoreRight;
  // Keep a sliver of both colours visible even at 100–0.
  const pctLeft = total === 0 ? 50 : Math.min(92, Math.max(8, Math.round((scoreLeft / total) * 100)));
  const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const secs = secondsLeft !== null ? secondsLeft % 60 : 0;
  const timer = secondsLeft !== null && (
    <View style={{ alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 14, paddingHorizontal: 12, height: 28, flexDirection: 'row', alignItems: 'center', gap: 6 }}
      accessibilityLabel={`PK battle, ${mins} minutes ${secs} seconds left`}>
      <Text variant="label" color={c.gold} style={{ fontStyle: 'italic', fontWeight: '800' }}>PK</Text>
      <Text variant="label" color="#fff" style={{ fontVariant: ['tabular-nums'] }}>{mins}:{String(secs).padStart(2, '0')}</Text>
    </View>
  );

  return (
    <View style={{ zIndex: 2 }}>
      <View style={{ height: 26, flexDirection: 'row' }} accessibilityLabel={`Score ${scoreLeft} to ${scoreRight}`}>
        <LinearGradient colors={['#1D6FE0', '#5AC8FA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pctLeft}%`, justifyContent: 'center', paddingLeft: 10 }}>
          <Text variant="label" color="#fff" style={{ fontVariant: ['tabular-nums'] }}>{scoreLeft.toLocaleString()}</Text>
        </LinearGradient>
        <LinearGradient colors={['#FFD666', '#F5B301']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 10 }}>
          <Text variant="label" color="#2A1A00" style={{ fontVariant: ['tabular-nums'] }}>{scoreRight.toLocaleString()}</Text>
        </LinearGradient>
        <View style={{ position: 'absolute', left: `${pctLeft}%`, top: -3, width: 6, height: 32, marginLeft: -3, borderRadius: 3, backgroundColor: '#fff',
          shadowColor: '#fff', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 }} />
      </View>
      {timer && (timerBelow ? <View style={{ position: 'absolute', top: 30, left: 0, right: 0 }}>{timer}</View> : <View style={{ paddingTop: 6 }}>{timer}</View>)}
    </View>
  );
}

/** Ends a battle whose clock has run out — safe to call speculatively; the RPC no-ops if it isn't live. */
export async function endBattleIfExpired(supabase: SupabaseClient, battle: PkBattle | null): Promise<boolean> {
  if (!battle || battle.status !== 'live' || !battle.ends_at) return true;
  if (new Date(battle.ends_at).getTime() > Date.now()) return true;
  try {
    await rpc(supabase, 'end_pk_battle', { p_battle_id: battle.id });
    return true;
  } catch (e) {
    // Already ended by the other side is fine; anything else (e.g. network) should be retried.
    return errorCode(e) === 'not_live';
  }
}
