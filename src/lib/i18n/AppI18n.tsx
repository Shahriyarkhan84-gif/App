import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchMyRegion } from '../events';
import { useProfile } from '../profile';
import { useSupabase } from '../supabase';
import { I18nProvider, type Language } from '.';

/**
 * I18nProvider wired to the app: the region's default language (from the
 * server-side region) and profiles.language kept in sync with the effective
 * language, so AI translation and caption defaults follow the UI.
 */
export function AppI18n({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const { profile } = useProfile();
  const [regionDefault, setRegionDefault] = useState<string | null>(null);
  const profileId = profile?.id;
  const profileLanguage = profile?.language;

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    fetchMyRegion(supabase)
      .then((r) => !cancelled && setRegionDefault(r?.default_language ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, profileId]);

  const onLanguage = useCallback(
    (code: Language) => {
      if (profileId && profileLanguage !== code) {
        void supabase.from('profiles').update({ language: code }).eq('id', profileId);
      }
    },
    [supabase, profileId, profileLanguage],
  );

  return <I18nProvider regionDefault={regionDefault} onLanguage={onLanguage}>{children}</I18nProvider>;
}
