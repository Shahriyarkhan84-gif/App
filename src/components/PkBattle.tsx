import { LiveKitRoom } from '@livekit/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { getLiveKitToken, rpc } from '@/lib/api';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName, normalizeRoom, ROOM_SELECT, type PkBattle, type Room } from '@/lib/types';

import { Stage } from './LiveStage';
import { Avatar, Row, Text } from './ui';

/** Height of the split-video block, matching the design canvas's ~44% of screen. */
export const PK_SPLIT_HEIGHT = 300;

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
  const secondsLeft = live ? Math.max(0, Math.round((new Date(battle!.ends_at!).getTime() - now) / 1000)) : null;

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
    <LiveKitRoom serverUrl={token.data.url} token={token.data.token} connect audio={false} video={false}>
      <Stage role="viewer" />
    </LiveKitRoom>
  );
}

/**
 * Full split-screen battle stage: my own live video (left/right, passed in
 * since the host/viewer screen already owns that LiveKitRoom connection) next
 * to the opponent's, a VS badge between them, and the score/timer bar below.
 * Neither host's video changes — each keeps publishing to their own room;
 * this only composes two existing viewer-safe streams side by side.
 */
export function PkBattleStage({ mySide, myStage, opponentRoom, mySideLabel, opponentSideLabel }: {
  mySide: 'a' | 'b' | null;
  myStage: ReactNode;
  opponentRoom: Room;
  mySideLabel: string;
  opponentSideLabel: string;
}) {
  const leftIsMe = mySide !== 'b';
  return (
    <View style={{ height: PK_SPLIT_HEIGHT, flexDirection: 'row', backgroundColor: '#000' }}>
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
      <View
        style={{
          position: 'absolute', top: PK_SPLIT_HEIGHT / 2 - 26, left: '50%', marginLeft: -26,
          width: 52, height: 52, borderRadius: 26, backgroundColor: c.background, borderWidth: 3, borderColor: c.gold,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text variant="label" color={c.gold} style={{ fontSize: 15, fontWeight: '800' }}>VS</Text>
      </View>
    </View>
  );
}

/** Score bar + timer, sits directly under `PkBattleStage`. */
export function PkBattleBar({ battle, mySide, secondsLeft }: { battle: PkBattle; mySide: 'a' | 'b' | null; secondsLeft: number | null }) {
  const scoreLeft = mySide === 'b' ? battle.score_b : battle.score_a;
  const scoreRight = mySide === 'b' ? battle.score_a : battle.score_b;
  const total = scoreLeft + scoreRight;
  const pctLeft = total === 0 ? 50 : Math.round((scoreLeft / total) * 100);
  const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const secs = secondsLeft !== null ? secondsLeft % 60 : 0;

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, gap: 8 }}>
      <View style={{ height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)' }}>
        <View style={{ width: `${pctLeft}%`, backgroundColor: c.primary, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 6 }} />
        <View style={{ width: `${100 - pctLeft}%`, backgroundColor: c.accent }} />
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" color={c.text} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>{scoreLeft.toLocaleString()}</Text>
        {secondsLeft !== null && (
          <View style={{ backgroundColor: c.surfaceRaised, borderRadius: 14, paddingHorizontal: 12, height: 28, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" color={c.gold} style={{ fontWeight: '700' }}>PK</Text>
            <Text variant="caption" color={c.text} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>{mins}:{String(secs).padStart(2, '0')}</Text>
          </View>
        )}
        <Text variant="caption" color={c.text} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>{scoreRight.toLocaleString()}</Text>
      </Row>
    </View>
  );
}

/** Ends a battle whose clock has run out — safe to call speculatively; the RPC no-ops if it isn't live. */
export async function endBattleIfExpired(supabase: SupabaseClient, battle: PkBattle | null) {
  if (!battle || battle.status !== 'live' || !battle.ends_at) return;
  if (new Date(battle.ends_at).getTime() > Date.now()) return;
  try {
    await rpc(supabase, 'end_pk_battle', { p_battle_id: battle.id });
  } catch {
    // Another participant (or this same check elsewhere) may have already ended it.
  }
}
