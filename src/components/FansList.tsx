import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, glassShadow, Row, Text } from '@/components/ui';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { shortTime } from '@/lib/time';
import { displayName, type Profile } from '@/lib/types';

type Fan = { follower_id: string; created_at: string; profile: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null };

/** People who followed you, newest first (Messages → Fans, and Me → My fans). */
export function FansList({ bottomInset = 16 }: { bottomInset?: number }) {
  const { c } = useTheme();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const offline = useOffline();
  const { data, error, loading, reload } = useFocusedAsync<Fan[]>(async () => {
    const { data, error } = await supabase.from('follows').select('follower_id,created_at').eq('followee_id', userId!).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const ids = (data ?? []).map((f) => f.follower_id);
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids) : { data: [] };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (data ?? []).map((f) => ({ ...f, profile: byId.get(f.follower_id) ?? null }));
  }, [userId], 'msg-fans');
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No fans yet', body: 'Go live — people who follow you show up here.' } })}>
      <FlatList
        data={data ?? []}
        keyExtractor={(f) => f.follower_id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset, gap: 8 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={stagger(index, 40)}>
            <PressScale scaleTo={0.98} onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.follower_id } })} accessibilityRole="button">
              <Row style={{ padding: 12, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
                <Avatar uri={item.profile?.avatar_url} name={displayName(item.profile)} size={46} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" numberOfLines={1}>{displayName(item.profile)}</Text>
                  <Text variant="caption" faint>Started following you</Text>
                </View>
                <Text variant="caption" faint>{shortTime(item.created_at)}</Text>
              </Row>
            </PressScale>
          </FadeIn>
        )}
      />
    </StateView>
  );
}
