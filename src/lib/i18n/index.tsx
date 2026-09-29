// Localization layer. Language = the user's saved choice → the device
// language (if we have a catalog for it) → the region's default language
// (regions.default_language) → English. The choice is mirrored to
// profiles.language, which the AI branches use (chat translation, caption
// default). Urdu is right-to-left: native layouts flip at launch (the
// expo-localization plugin sets supportsRTL), so switching direction in-app
// takes effect after a restart; web flips immediately via <html dir>.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nManager, Platform } from 'react-native';

import { bn } from './bn';
import { en, type Catalog, type MessageKey } from './en';
import { hi } from './hi';
import { ur } from './ur';

export type Language = 'en' | 'ur' | 'hi' | 'bn';

export const LANGUAGES: readonly { code: Language; name: string; rtl: boolean }[] = [
  { code: 'en', name: 'English', rtl: false },
  { code: 'ur', name: 'اردو', rtl: true },
  { code: 'hi', name: 'हिन्दी', rtl: false },
  { code: 'bn', name: 'বাংলা', rtl: false },
];

const CATALOGS: Record<Language, Catalog> = { en, ur, hi, bn };
const STORAGE_KEY = 'zyna.language';

export const isLanguage = (code: string | null | undefined): code is Language =>
  !!code && LANGUAGES.some((l) => l.code === code);

export const isRtl = (code: Language) => LANGUAGES.find((l) => l.code === code)?.rtl ?? false;

type Vars = Record<string, string | number>;

export function translate(language: Language, key: MessageKey, vars?: Vars): string {
  const template = CATALOGS[language][key] ?? en[key];
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
}

// Language for code outside React (e.g. friendlyError); set by the provider.
let current: Language = 'en';
function setCurrent(language: Language) {
  current = language;
}

/** Translates in the current app language; usable outside React. */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(current, key, vars);
}

export function hasMessage(key: string): key is MessageKey {
  return key in en;
}

export function deviceLanguage(): Language | null {
  for (const locale of getLocales()) {
    if (isLanguage(locale.languageCode)) return locale.languageCode;
  }
  return null;
}

/** Pure resolution order, exported for reuse/tests. */
export function resolveLanguage(saved: string | null, device: Language | null, regionDefault: string | null): Language {
  if (isLanguage(saved)) return saved;
  if (device) return device;
  if (isLanguage(regionDefault)) return regionDefault;
  return 'en';
}

type Ctx = {
  language: Language;
  /** The user's explicit choice, or null when following the device/region. */
  saved: Language | null;
  rtl: boolean;
  /** Returns true when the app must restart to switch layout direction. */
  setLanguage: (code: Language | null) => Promise<boolean>;
  t: typeof t;
};

const I18nContext = createContext<Ctx>({ language: 'en', saved: null, rtl: false, setLanguage: async () => false, t });

function applyDirection(rtl: boolean): boolean {
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    return false;
  }
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(rtl);
  return true;
}

export function I18nProvider({
  children, regionDefault, onLanguage,
}: {
  children: ReactNode;
  /** Region's default language, used when the device language has no catalog. */
  regionDefault?: string | null;
  /** Called with the effective language (e.g. to mirror it to profiles.language). */
  onLanguage?: (code: Language) => void;
}) {
  const [saved, setSaved] = useState<Language | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => setSaved(isLanguage(v) ? v : null))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const language = resolveLanguage(saved, deviceLanguage(), regionDefault ?? null);
  useLayoutEffect(() => setCurrent(language), [language]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = language;
    if (loaded) onLanguage?.(language);
  }, [language, loaded, onLanguage]);

  const setLanguage = useCallback(async (code: Language | null) => {
    if (code) await AsyncStorage.setItem(STORAGE_KEY, code);
    else await AsyncStorage.removeItem(STORAGE_KEY);
    setSaved(code);
    const next = resolveLanguage(code, deviceLanguage(), regionDefault ?? null);
    setCurrent(next);
    return applyDirection(isRtl(next));
  }, [regionDefault]);

  const value = useMemo<Ctx>(
    () => ({ language, saved, rtl: isRtl(language), setLanguage, t: (key, vars) => translate(language, key, vars) }),
    [language, saved, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Re-renders on language change. */
export function useI18n() {
  return useContext(I18nContext);
}
