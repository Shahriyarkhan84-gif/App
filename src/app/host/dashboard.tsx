import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { FadeIn, PressScale } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Button, Coin, compactNumber, Row, Screen, Sheet, Text } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { shortTime } from '@/lib/time';
import { displayName, type Profile } from '@/lib/types';

const WEEKLY_GOAL_HOURS = 20;
const MAX_ADMINS = 5;

type Person = Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url'>;
type StreamRow = { id: string; title: string | null; started_at: string; ended_at: string | null; peak_viewers: number; gift_coins: number };
type Dashboard = {
  live: boolean;
  roomId: string | null;
  party: boolean;
  today: { seconds: number; sessions: number; diamonds: number; gifts: number; newFollowers: number; totalFollowers: number; peak: number };
  weekSeconds: number;
  admins: Person[];
  fans: Person[];
  warnings: number;
  recent: (StreamRow & { secs: number })[];
};

function seconds(s: StreamRow, now: number) {
  return Math.max(0, ((s.ended_at ? new Date(s.ended_at).getTime() : now) - new Date(s.started_at).getTime()) / 1000);
}

function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Host app dashboard from the design canvas: today's numbers, weekly hours, room admins, standing, recent lives. */
export default function HostDashboardScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const { profile, host } = useProfile();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useFocusedAsync<Dashboard>(async () => {
    const me = profile!.id;
    const now = Date.now();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(dayStart); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

    const [room, modeRow, week, recent, giftsToday, followersToday, followersTotal, warnings, fans] = await Promise.all([
      supabase.from('rooms').select('id,status').eq('host_id', me).maybeSingle(),
      supabase.from('rooms').select('mode').eq('host_id', me).maybeSingle(),
      supabase.from('streams').select('id,title,started_at,ended_at,peak_viewers,gift_coins').eq('host_id', me).gte('started_at', weekStart.toISOString()),
      supabase.from('streams').select('id,title,started_at,ended_at,peak_viewers,gift_coins').eq('host_id', me).order('started_at', { ascending: false }).limit(5),
      supabase.from('gifts').select('host_share').eq('host_id', me).gte('created_at', dayStart.toISOString()),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', me).gte('created_at', dayStart.toISOString()),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', me),
      supabase.from('moderation_actions').select('*', { count: 'exact', head: true }).eq('target_user_id', me).eq('action', 'warning'),
      supabase.from('follows').select('follower_id').eq('followee_id', me).order('created_at', { ascending: false }).limit(50),
    ]);
    // A failed query must not show as 0 diamonds / 0 followers / "good standing".
    for (const r of [room, week, recent, giftsToday, followersToday, followersTotal, warnings, fans]) if (r.error) throw r.error;

    const adminIds = room.data ? ((await supabase.from('room_admins').select('user_id').eq('room_id', room.data.id)).data ?? []).map((a) => a.user_id) : [];
    const fanIds = (fans.data ?? []).map((f) => f.follower_id);
    const ids = [...new Set([...adminIds, ...fanIds])];
    const { data: people } = ids.length ? await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids) : { data: [] as Person[] };
    const byId = new Map((people ?? []).map((p) => [p.id, p as Person]));

    const weekRows = (week.data ?? []) as StreamRow[];
    const todayRows = weekRows.filter((s) => new Date(s.started_at) >= dayStart);
    const gifts = giftsToday.data ?? [];
    return {
      live: room.data?.status === 'live',
      roomId: room.data?.id ?? null,
      party: modeRow.data?.mode === 'voice' || modeRow.data?.mode === 'video',
      today: {
        seconds: todayRows.reduce((n, s) => n + seconds(s, now), 0),
        sessions: todayRows.length,
        diamonds: gifts.reduce((n, g) => n + (g.host_share ?? 0), 0),
        gifts: gifts.length,
        newFollowers: followersToday.count ?? 0,
        totalFollowers: followersTotal.count ?? 0,
        peak: todayRows.reduce((n, s) => Math.max(n, s.peak_viewers ?? 0), 0),
      },
      weekSeconds: weekRows.reduce((n, s) => n + seconds(s, now), 0),
      admins: adminIds.map((id) => byId.get(id)).filter((p): p is Person => !!p),
      fans: fanIds.filter((id) => !adminIds.includes(id)).map((id) => byId.get(id)).filter((p): p is Person => !!p),
      warnings: warnings.count ?? 0,
      recent: ((recent.data ?? []) as StreamRow[]).map((s) => ({ ...s, secs: seconds(s, now) })),
    };
  }, [profile?.id], 'host-dashboard');

  // Admin changes go through the set_room_admin RPC; the server checks you own the room.
  const setAdmin = async (user: Person, enabled: boolean) => {
    setBusy(user.id);
    try {
      await rpc(supabase, 'set_room_admin', { p_user: user.id, p_enabled: enabled });
      setPicking(false);
      reload();
    } catch (e) {
      Alert.alert('Could not update admins', friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const weekHours = (data?.weekSeconds ?? 0) / 3600;
  const pct = Math.min(1, weekHours / WEEKLY_GOAL_HOURS);

  return (
    <Screen edges={[]}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data && profile && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            <Row gap={12}>
              <Avatar uri={profile.avatar_url} name={displayName(profile)} size={56} ring={c.gold} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="h3" numberOfLines={1}>{displayName(profile)}</Text>
                <Text variant="caption" muted>HOST-{host?.host_code ?? profile.user_number}</Text>
              </View>
              <Row gap={6} style={{ paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: data.live ? c.primary : c.surfaceRaised }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: data.live ? '#fff' : c.textFaint }} />
                <Text variant="caption" color={data.live ? '#fff' : c.textMuted} style={{ fontWeight: '700' }}>{data.live ? 'Live' : 'Offline'}</Text>
              </Row>
            </Row>

            <Button title={data.live ? 'Back to your live' : 'Go live now'} onPress={() => {
              if (!data.live) router.dismissTo('/create');
              else if (data.party && data.roomId) router.push({ pathname: '/party/[roomId]', params: { roomId: data.roomId } });
              else router.push('/host/live');
            }} />

            <View style={{ gap: 8 }}>
              <Text variant="h3">Today</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Tile label="Live time" value={duration(data.today.seconds)} sub={`${data.today.sessions} session${data.today.sessions === 1 ? '' : 's'}`} />
                <Tile label="Diamonds" value={data.today.diamonds.toLocaleString()} sub={`from ${data.today.gifts} gifts`} />
                <Tile label="New followers" value={data.today.newFollowers.toLocaleString()} sub={`total ${compactNumber(data.today.totalFollowers)}`} />
                <Tile label="Peak viewers" value={data.today.peak.toLocaleString()} sub="today" />
              </View>
            </View>

            <FadeIn style={{ padding: 16, borderRadius: 16, backgroundColor: c.surface, gap: 10 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">Weekly live hours</Text>
                <Text variant="label">{weekHours.toFixed(1)} / {WEEKLY_GOAL_HOURS} h</Text>
              </Row>
              <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: WEEKLY_GOAL_HOURS, now: Math.round(weekHours) }} style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceRaised, overflow: 'hidden' }}>
                <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 4, backgroundColor: c.primary }} />
              </View>
              <Text variant="caption" muted>
                {pct >= 1 ? 'Weekly goal reached — great work!' : `${(WEEKLY_GOAL_HOURS - weekHours).toFixed(1)} more hours to reach ${WEEKLY_GOAL_HOURS} h this week`}
              </Text>
            </FadeIn>

            <FadeIn style={{ padding: 16, borderRadius: 16, backgroundColor: c.surface, gap: 10 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">Room admins</Text>
                <Text variant="caption" muted>{data.admins.length} of {MAX_ADMINS}</Text>
              </Row>
              <Text variant="caption" muted>{'Admins can mute, kick, block and report in your room while you\'re live.'}</Text>
              {data.admins.map((a) => (
                <Row key={a.id} gap={10}>
                  <Avatar uri={a.avatar_url} name={displayName(a)} size={34} />
                  <Text style={{ flex: 1 }} numberOfLines={1}>{displayName(a)}</Text>
                  <Button title="Remove" variant="outline" size="sm" loading={busy === a.id} onPress={() => confirmAction('Remove room admin?', `${displayName(a)} can no longer moderate your room.`, 'Remove', () => void setAdmin(a, false))} />
                </Row>
              ))}
              {data.admins.length < MAX_ADMINS && (
                <Button title="+ Add admin" variant="secondary" size="sm" onPress={() => setPicking(true)} />
              )}
            </FadeIn>

            <Row gap={12} style={{ padding: 16, borderRadius: 16, backgroundColor: c.surface }}>
              <Ionicons name={data.warnings ? 'warning-outline' : 'shield-checkmark-outline'} size={26} color={data.warnings ? c.warning : c.success} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label">{data.warnings ? 'Warnings on your account' : 'Account in good standing'}</Text>
                <Text variant="caption" muted>{data.warnings} warning{data.warnings === 1 ? '' : 's'}</Text>
              </View>
            </Row>

            <View style={{ gap: 4 }}>
              <Text variant="h3">Recent lives</Text>
              {data.recent.length === 0 ? (
                <Text muted style={{ paddingVertical: 8 }}>No lives yet — tap Go live now to start.</Text>
              ) : data.recent.map((s) => (
                <PressScale key={s.id} scaleTo={0.98} onPress={() => s.ended_at && router.push({ pathname: '/host/summary', params: { streamId: s.id } })} accessibilityRole="button">
                  <Row style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{s.title || 'Live stream'}</Text>
                      <Text variant="caption" faint>{shortTime(s.started_at)} · {duration(s.secs)}</Text>
                    </View>
                    {/* gift_coins is the gifts' full coin value (not the host's diamond share). */}
                    <Row gap={4}>
                      <Coin size={14} />
                      <Text variant="label" color={c.violetText} accessibilityLabel={`${(s.gift_coins ?? 0).toLocaleString()} coins in gifts`}>{(s.gift_coins ?? 0).toLocaleString()}</Text>
                    </Row>
                  </Row>
                </PressScale>
              ))}
            </View>
          </ScrollView>
        )}
      </StateView>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Add a room admin">
        {data && data.fans.length === 0 ? (
          <Text muted>Only your followers can be admins. Nobody follows you yet.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {data?.fans.map((f) => (
              <Row key={f.id} gap={10} style={{ paddingVertical: 8 }}>
                <Avatar uri={f.avatar_url} name={displayName(f)} size={36} />
                <Text style={{ flex: 1 }} numberOfLines={1}>{displayName(f)}</Text>
                <Button title="Add" size="sm" loading={busy === f.id} onPress={() => setAdmin(f, true)} />
              </Row>
            ))}
          </ScrollView>
        )}
      </Sheet>
    </Screen>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  const { c } = useTheme();
  return (
    <View style={{ width: '48.8%', padding: 14, borderRadius: 16, backgroundColor: c.surface, gap: 4 }}>
      <Text variant="caption" muted>{label}</Text>
      <Text style={{ fontFamily: fonts.display, fontSize: 24 }}>{value}</Text>
      <Text variant="caption" faint>{sub}</Text>
    </View>
  );
}
