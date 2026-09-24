import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Chip, Input, Row, Screen, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { useAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName, type Profile } from '@/lib/types';

type Ranking = { rank: number; subject_id: string; label: string; avatar_url: string | null; score: number };
const KINDS = [
  { id: 'live', label: 'Live' },
  { id: 'creator', label: 'Creators' },
  { id: 'gifter', label: 'Gifters' },
  { id: 'country', label: 'Countries' },
] as const;
const PERIODS = ['day', 'week', 'month'] as const;

type SearchResult = Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url' | 'country'> & { host_code?: string };

export default function DiscoverScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('live');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('week');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ q: string; rows: SearchResult[] } | null>(null);

  const rankings = useAsync(() => rpc<Ranking[]>(supabase, 'get_rankings', { p_kind: kind, p_period: period }), [kind, period]);

  // Search by name, @username, or permanent Host ID (HOST-00018452).
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let rows: SearchResult[] = [];
      if (/^host-\d+$/i.test(q)) {
        const { data } = await supabase.from('hosts').select('host_code,profile:profiles(id,display_name,username,avatar_url,country)').eq('host_code', q.toUpperCase()).limit(1);
        rows = (data ?? []).flatMap((h) => {
          const p = h.profile as unknown as SearchResult | null;
          return p ? [{ ...p, host_code: h.host_code }] : [];
        });
      } else {
        const term = q.replace(/[%_,()@]/g, ' ').trim();
        const { data } = await supabase.from('profiles').select('id,display_name,username,avatar_url,country')
          .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`).limit(25);
        rows = (data ?? []) as SearchResult[];
      }
      if (!cancelled) setResults({ q, rows });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, supabase]);

  const searching = q.length >= 2;

  const openRanking = (r: Ranking) => {
    if (kind === 'live') router.push({ pathname: '/live/[roomId]', params: { roomId: r.subject_id } });
    else if (kind !== 'country') router.push({ pathname: '/user/[id]', params: { id: r.subject_id } });
  };

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12 }}>
        <Text variant="h1">Discover</Text>
        <Input value={query} onChangeText={setQuery} placeholder="Search people or HOST-ID" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search" />
      </View>

      {searching ? (
        <StateView
          state={resolveState({
            offline, loading: results?.q !== q, error: null, data: results?.q === q ? results.rows : undefined, onRetry: () => setQuery(query + ''),
            isEmpty: (d) => d.length === 0, empty: { title: 'No matches', body: 'Try a username or a Host ID like HOST-00000001.' },
          })}
        >
          <FlatList
            data={results?.rows ?? []}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            renderItem={({ item }) => (
              <Pressable onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.id } })}>
                <Row style={{ paddingVertical: 8 }}>
                  <Avatar uri={item.avatar_url} name={displayName(item)} />
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{displayName(item)}</Text>
                    <Text variant="caption" muted>{[item.username && `@${item.username}`, item.host_code, item.country].filter(Boolean).join(' · ')}</Text>
                  </View>
                </Row>
              </Pressable>
            )}
          />
        </StateView>
      ) : (
        <>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {KINDS.map((k) => <Chip key={k.id} label={k.label} selected={kind === k.id} onPress={() => setKind(k.id)} />)}
            </Row>
            {kind !== 'live' && (
              <Row gap={8}>
                {PERIODS.map((p) => <Chip key={p} label={p === 'day' ? 'Today' : p === 'week' ? 'This week' : 'This month'} selected={period === p} onPress={() => setPeriod(p)} />)}
              </Row>
            )}
          </View>
          <StateView
            state={resolveState({
              offline, loading: rankings.loading, error: rankings.error, data: rankings.data, onRetry: rankings.reload,
              isEmpty: (d) => d.length === 0, empty: { title: 'No rankings yet', body: 'Rankings fill up as people go live and send gifts.' },
            })}
          >
            <FlatList
              data={rankings.data ?? []}
              keyExtractor={(r) => `${r.rank}-${r.subject_id}`}
              contentContainerStyle={{ padding: 16, gap: 4 }}
              renderItem={({ item }) => (
                <Pressable onPress={() => openRanking(item)} disabled={kind === 'country'}>
                  <Row style={{ paddingVertical: 8 }}>
                    <Text variant="h3" color={item.rank <= 3 ? c.accent : c.textMuted} style={{ width: 32, textAlign: 'center' }}>{item.rank}</Text>
                    {kind !== 'country' && <Avatar uri={item.avatar_url} name={item.label} />}
                    <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{item.label}</Text>
                    <Text variant="label" muted>{kind === 'live' ? `👁 ${item.score}` : `🪙 ${Number(item.score).toLocaleString()}`}</Text>
                  </Row>
                </Pressable>
              )}
            />
          </StateView>
        </>
      )}
    </Screen>
  );
}
