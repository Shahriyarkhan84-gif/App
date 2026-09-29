import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { FadeIn, stagger } from '@/components/Motion';
import { resolveState, StateView, type ViewState } from '@/components/StateView';
import { Avatar, Card, compactNumber, Row, Screen, Text, TextTabs } from '@/components/ui';
import { EVENT_SELECT, eventPhase, scoreLabel, timeLeft, type AppEvent, type LeaderRow } from '@/lib/events';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName, type GiftItem } from '@/lib/types';

type Role = 'host' | 'gifter';

/** Event detail: countdown, rewards, qualifying gifts and live leaderboards. */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supabase = useSupabase();
  const offline = useOffline();
  const { c, hPadding } = useTheme();
  const { profile } = useProfile();
  const [role, setRole] = useState<Role>('host');

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data: event, error: e1 } = await supabase.from('events').select(EVENT_SELECT).eq('id', id).maybeSingle();
    if (e1) throw e1;
    if (!event) return { event: null, board: [] as LeaderRow[], gifts: [] as GiftItem[] };
    const ev = event as AppEvent;
    const [board, gifts] = await Promise.all([
      supabase.rpc('event_leaderboard', { p_event_id: id, p_role: ev.kind === 'pk_battle' ? 'host' : role, p_limit: 50 }),
      ev.gift_ids?.length ? supabase.from('gift_catalog').select('id,name,icon,coin_price').in('id', ev.gift_ids) : Promise.resolve({ data: [] }),
    ]);
    if (board.error) throw board.error;
    return { event: ev, board: (board.data ?? []) as LeaderRow[], gifts: (gifts.data ?? []) as GiftItem[] };
  }, [id, role]);

  // Scores move with every qualifying gift / battle.
  useRealtime('event_scores', `event_id=eq.${id}`, () => reload(), !!data?.event && eventPhase(data.event) === 'live');

  const event = data?.event;
  let state: ViewState = resolveState({ offline, loading, error, data, onRetry: reload });
  if (state.kind === 'success' && !event) state = { kind: 'empty', title: 'Event not found', body: 'It may have been cancelled.' };
  const phase = event ? eventPhase(event) : 'ended';
  const rewards = (event?.rewards ?? []).filter((r) => event?.kind === 'pk_battle' ? r.role === 'host' : r.role === role);
  const mine = data?.board.find((r) => r.user_id === profile?.id);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: event?.title ?? 'Event' }} />
      <StateView state={state}>
        <ScrollView
          contentContainerStyle={{ padding: hPadding, gap: 16, maxWidth: 900, width: '100%', alignSelf: 'center' }}
          refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={c.text} />}
        >
          <Card style={{ backgroundColor: phase === 'live' ? c.goldSurface : c.surface, borderColor: phase === 'live' ? c.goldBorder : c.divider }}>
            <Text variant="caption" color={phase === 'live' ? c.goldText : c.textMuted} style={{ fontWeight: '700' }}>
              {phase === 'live' ? `LIVE · ends in ${timeLeft(event!.ends_at)}` : phase === 'upcoming' ? `Starts in ${timeLeft(event!.starts_at)}` : 'Ended'}
            </Text>
            <Text variant="h2">{event?.title}</Text>
            {!!event?.description && <Text muted>{event.description}</Text>}
            <Text variant="caption" muted>
              {event?.kind === 'pk_battle' ? 'Win a PK battle: 3 pts · tie: 1 pt' : 'Every qualifying gift counts for the host and the sender'}
              {event?.region ? '' : ' · Worldwide'}
            </Text>
            {!!data?.gifts.length && (
              <Row gap={8} style={{ flexWrap: 'wrap' }}>
                <Text variant="caption" muted>Qualifying gifts:</Text>
                {data.gifts.map((g) => <Text key={g.id} variant="caption">{g.icon} {g.name}</Text>)}
              </Row>
            )}
          </Card>

          {event?.kind === 'gifting' && (
            <TextTabs options={[{ id: 'host', label: 'Top hosts' }, { id: 'gifter', label: 'Top gifters' }] as const} value={role} onChange={setRole} />
          )}

          {rewards.length > 0 && (
            <Card>
              <Text variant="h3">Rewards</Text>
              {rewards.map((r, i) => (
                <Text key={i} muted>#{r.rank_from}{r.rank_to > r.rank_from ? `–${r.rank_to}` : ''} · {r.reward}</Text>
              ))}
            </Card>
          )}

          {mine && <Text style={{ fontWeight: '700' }} color={c.gold}>You’re #{mine.rank} with {compactNumber(mine.score)} {scoreLabel(event!.kind)}</Text>}

          {data?.board.length === 0 && (
            <Text muted style={{ textAlign: 'center', marginTop: 16 }}>
              {phase === 'upcoming' ? 'The leaderboard opens when the event starts.' : 'No scores yet — be the first!'}
            </Text>
          )}
          {data?.board.map((r, i) => (
            <FadeIn key={r.user_id} delay={stagger(i)}>
              <Row style={{ alignItems: 'center', gap: 12 }}>
                <Text variant="h3" color={r.rank <= 3 ? c.gold : c.textMuted} style={{ width: 32, textAlign: 'center' }}>{r.rank}</Text>
                <Avatar uri={r.avatar_url} name={displayName(r)} size={40} ring={r.rank === 1 ? c.gold : undefined} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} onPress={() => router.push(`/user/${r.user_id}`)}>{displayName(r)}</Text>
                  {!!r.reward && <Text variant="caption" color={c.goldText}>{r.reward}</Text>}
                </View>
                <Text style={{ fontWeight: '700' }}>{compactNumber(r.score)} <Text variant="caption" muted>{scoreLabel(event!.kind)}</Text></Text>
              </Row>
            </FadeIn>
          ))}
        </ScrollView>
      </StateView>
    </Screen>
  );
}
