import { ScrollView, View } from 'react-native';

import { useAsync } from '@/lib/hooks';
import { similarLives } from '@/lib/smartSearch';
import { useSupabase } from '@/lib/supabase';

import { RoomCard } from './RoomCard';
import { Text } from './ui';

/** A row of lives like the given room (smart search, or same category). Renders nothing when there are none. */
export function SimilarLives({ roomId, title, category, heading = 'Similar lives' }: { roomId: string; title: string; category: string; heading?: string }) {
  const supabase = useSupabase();
  const { data } = useAsync(() => similarLives(supabase, { roomId, title, category }), [roomId, title, category], `similar:${roomId}`);
  if (!data || data.length === 0) return null;
  return (
    <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 8 }}>
      <Text variant="label">{heading}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {data.map((r) => <RoomCard key={r.id} room={r} width={140} />)}
      </ScrollView>
    </View>
  );
}
