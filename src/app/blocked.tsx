import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';

import { FramedAvatar } from '@/components/FramedAvatar';
import { resolveState, StateView } from '@/components/StateView';
import { Button, Row, Screen, Text } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName, type Profile } from '@/lib/types';

type Blocked = Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url' | 'user_number'> & { blocked_at: string };

/** Settings → Privacy → Blocked accounts: everyone you've blocked, with Unblock. */
export default function BlockedScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();

  const { data, error, loading, reload } = useFocusedAsync<Blocked[]>(async () => {
    // Your own blocks only (RLS), then their public profiles.
    const { data: rows, error } = await supabase.from('user_blocks').select('blocked_id,created_at').eq('blocker_id', userId!).order('created_at', { ascending: false });
    if (error) throw error;
    if (!rows?.length) return [];
    const { data: people, error: e2 } = await supabase.from('profiles').select('id,display_name,username,avatar_url,user_number').in('id', rows.map((r) => r.blocked_id));
    if (e2) throw e2;
    const byId = new Map((people ?? []).map((p) => [p.id, p]));
    return rows.flatMap((r) => { const p = byId.get(r.blocked_id); return p ? [{ ...p, blocked_at: r.created_at } as Blocked] : []; });
  }, [userId], 'blocked');

  const unblock = (p: Blocked) =>
    confirmAction(`Unblock ${displayName(p)}?`, 'They will be able to message you and see your lives again. You won\'t follow each other again automatically.', 'Unblock', async () => {
      try {
        await rpc(supabase, 'unblock_user', { p_user: p.id });
        reload();
      } catch (e) {
        Alert.alert('Could not unblock', friendlyError(e));
      }
    });

  return (
    <Screen edges={['bottom']}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: "You haven't blocked anyone", body: 'Block someone from their profile (••• → Block).' } })}>
        <FlatList
          data={data ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 640, width: '100%', alignSelf: 'center' }}
          renderItem={({ item }) => (
            <Row style={{ padding: 12, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder }}>
              <Pressable onPress={() => router.push(`/user/${item.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${displayName(item)}`}>
                <FramedAvatar uri={item.avatar_url} name={displayName(item)} size={44} />
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" numberOfLines={1}>{displayName(item)}</Text>
                <Text variant="caption" faint>ID {item.user_number}</Text>
              </View>
              <Button title="Unblock" size="sm" variant="secondary" onPress={() => unblock(item)} />
            </Row>
          )}
        />
      </StateView>
    </Screen>
  );
}
