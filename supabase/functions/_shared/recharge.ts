// Input checks for the web recharge link (recharge function).
import { HttpError } from './cors.ts';

/** An 8-digit Zynalive ID, spaces allowed ("4821 7730"). */
export function parseId(id: unknown): number {
  const digits = typeof id === 'string' ? id.replace(/\s+/g, '') : '';
  if (!/^\d{8}$/.test(digits)) throw new HttpError(400, 'user_not_found');
  return Number(digits);
}

export function parseAgency(code: unknown): string | null {
  if (code === undefined || code === null || code === '') return null;
  if (typeof code !== 'string' || !/^[A-Za-z0-9-]{3,20}$/.test(code)) throw new HttpError(400, 'invalid_agency_code');
  return code;
}
