import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useEffect, useState } from 'react';

import { useRealtime } from './hooks';
import { useSupabase } from './supabase';

/**
 * Whether the signed-in person has unread direct messages or notifications (the dot on the
 * Messages tab). Rechecked when a message or notification arrives or is marked read.
 */
export function useHasUnread(): boolean {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const [unread, setUnread] = useState(false);

  const check = useCallback(async () => {
    if (!userId) return;
    // Muted chats (Messages → long press → Mute) don't light the dot. Ignored if it can't be read.
    const { data: muted } = await supabase.from('dm_thread_prefs').select('other_id').eq('user_id', userId).eq('muted', true);
    let unreadDms = supabase.from('direct_messages').select('id', { count: 'exact', head: true }).eq('recipient_id', userId).is('read_at', null);
    if (muted?.length) unreadDms = unreadDms.not('sender_id', 'in', `(${muted.map((m) => m.other_id).join(',')})`);
    const [dms, notes] = await Promise.all([
      unreadDms,
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null),
    ]);
    setUnread((dms.count ?? 0) + (notes.count ?? 0) > 0);
  }, [supabase, userId]);

  useEffect(() => {
    let live = true;
    // First check once the screen has settled; later ones come from realtime.
    const t = setTimeout(() => { if (live) void check().catch(() => {}); }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [check]);
  const recheck = () => void check().catch(() => {});
  useRealtime('direct_messages', userId ? `recipient_id=eq.${userId}` : undefined, recheck, !!userId);
  useRealtime('notifications', userId ? `user_id=eq.${userId}` : undefined, recheck, !!userId);
  return !!userId && unread;
}
