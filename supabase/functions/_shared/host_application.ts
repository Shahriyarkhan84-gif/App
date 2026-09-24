// Pure helpers for the host-application function (unit-tested in host_application_test.ts).

/** Pakistani mobile number typed without the leading 0: 3XXXXXXXXX → +923XXXXXXXXX, else null. */
export function normalizePkMobile(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('92')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return /^3\d{9}$/.test(d) ? `+92${d}` : null;
}

/** CNIC is 13 digits (printed 00000-0000000-0). Returns the digits or null. */
export function normalizeCnic(input: string): string | null {
  const d = input.replace(/\D/g, '');
  return d.length === 13 ? d : null;
}

/** True when any number Didit read from the card equals the typed CNIC. */
export function cnicMatches(cnic: string, ...ocr: (string | null | undefined)[]): boolean {
  return ocr.some((v) => !!v && v.replace(/\D/g, '') === cnic);
}

const tokens = (s: string) =>
  s.normalize('NFKD').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);

/**
 * Lenient name check: every typed name part except at most one must appear on
 * the card (handles middle names, "Muhammad"/"Mohammad" variants are caught by review).
 */
export function nameMatches(typed: string, ocrFullName: string | null | undefined): boolean {
  if (!ocrFullName) return false;
  const want = tokens(typed);
  const have = new Set(tokens(ocrFullName));
  if (want.length === 0) return false;
  const hits = want.filter((t) => have.has(t)).length;
  return hits >= Math.max(1, want.length - 1);
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
