import { createClient } from 'npm:@supabase/supabase-js@2';

import { requireEnv } from './cors.ts';

/** Service-role client — bypasses RLS and may call internal_* RPCs. Server-side only. */
export function adminClient() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

/** Records a provider event id; returns false if it was already processed (replay). */
export async function markEventProcessed(provider: string, eventId: string) {
  const { data, error } = await adminClient()
    .from('processed_webhook_events')
    .upsert({ provider, event_id: eventId }, { onConflict: 'provider,event_id', ignoreDuplicates: true })
    .select('event_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function alreadyProcessed(provider: string, eventId: string) {
  const { data, error } = await adminClient()
    .from('processed_webhook_events')
    .select('event_id')
    .eq('provider', provider)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}
