const NAMES: Record<string, string> = {
  PK: 'Pakistan', IN: 'India', BD: 'Bangladesh', NP: 'Nepal', LK: 'Sri Lanka', AF: 'Afghanistan', AE: 'United Arab Emirates',
  SA: 'Saudi Arabia', QA: 'Qatar', OM: 'Oman', KW: 'Kuwait', BH: 'Bahrain', GB: 'United Kingdom', US: 'United States', CA: 'Canada',
  AU: 'Australia', DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain', TR: 'Türkiye', MY: 'Malaysia', SG: 'Singapore', CN: 'China',
};

/** Flag emoji for an ISO 3166-1 alpha-2 code (e.g. PK → 🇵🇰). */
export function flag(code: string) {
  return code.toUpperCase().replace(/[A-Z]/g, (ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Country name for an ISO code, falling back to the code. */
export function countryName(code: string) {
  const c = code.toUpperCase();
  if (NAMES[c]) return NAMES[c];
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c;
  } catch {
    return c;
  }
}
