import { useState } from 'react';
import { View } from 'react-native';

import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';

import { Pop } from './Motion';
import { Text } from './ui';

/**
 * The sticker the host put on their live (Host tools → Sticker). Read separately from the room (so a
 * server without the column still works) and kept current by realtime.
 */
export function useLiveSticker(roomId: string | undefined) {
  const supabase = useSupabase();
  const [live, setLive] = useState<{ room: string; sticker: string | null } | null>(null);
  const first = useAsync(async () => {
    if (!roomId) return null;
    const { data, error } = await supabase.from('rooms').select('sticker').eq('id', roomId).maybeSingle();
    return error ? null : ((data as { sticker?: string | null } | null)?.sticker ?? null);
  }, [roomId]);
  useRealtime('rooms', roomId ? `id=eq.${roomId}` : undefined, (p) => {
    const next = p.new as { sticker?: string | null };
    if (roomId && 'sticker' in next) setLive({ room: roomId, sticker: next.sticker ?? null });
  }, !!roomId);
  return live && live.room === roomId ? live.sticker : first.data ?? null;
}

/** The sticker in the top-right corner of the video. */
export function LiveSticker({ sticker, top }: { sticker: string | null; top: number }) {
  if (!sticker) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 14, top }} accessibilityLabel={`Sticker ${sticker}`}>
      <Pop key={sticker} from={0.3}>
        <Text style={{ fontSize: 54, lineHeight: 64 }}>{sticker}</Text>
      </Pop>
    </View>
  );
}
