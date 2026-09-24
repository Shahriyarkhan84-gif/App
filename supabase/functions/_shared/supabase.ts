import { createClient } from 'npm:@supabase/supabase-js@2';

import { requireEnv } from './cors.ts';

/** Service-role client — bypasses RLS. Only use for trusted server-side writes. */
export function adminClient() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

/** Client that acts as the calling user (RLS applies) using their Clerk token. */
export function userClient(token: string) {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    accessToken: async () => token,
  });
}

export const VIDEO_COLUMNS =
  'id,title,description,genres,release_year,duration_seconds,maturity_rating,poster_url,backdrop_url,is_premium,featured,created_at';
