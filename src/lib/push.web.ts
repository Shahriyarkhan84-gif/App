import type { SupabaseClient } from '@supabase/supabase-js';

/** The website has no phone notifications; the in-app list still updates live. */
export function usePushNotifications(_supabase: SupabaseClient, _signedIn: boolean) {}

export async function unregisterPush(_supabase: SupabaseClient) {}
