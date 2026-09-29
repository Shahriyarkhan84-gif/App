import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma, Region } from '@zynalive/database';

import { PrismaService } from '../prisma/prisma.service';

type RegionSeed = Omit<Region, 'features'> & { features: Prisma.InputJsonValue };

// Same rows as the seed in supabase/migrations/20260925030000_regions_events.sql.
export const REGION_SEED: RegionSeed[] = [
  { code: 'PK', name: 'Pakistan', countries: ['PK'], currency: 'pkr', defaultLanguage: 'ur', languages: ['ur', 'en'], timezone: 'Asia/Karachi', active: true, sort: 1, features: { pk_battles: true, uploads: true, withdrawals: true } },
  { code: 'IN', name: 'India', countries: ['IN'], currency: 'inr', defaultLanguage: 'hi', languages: ['hi', 'en', 'bn'], timezone: 'Asia/Kolkata', active: true, sort: 2, features: { pk_battles: true, uploads: true, withdrawals: false } },
  { code: 'BD', name: 'Bangladesh', countries: ['BD'], currency: 'bdt', defaultLanguage: 'bn', languages: ['bn', 'en'], timezone: 'Asia/Dhaka', active: true, sort: 3, features: { pk_battles: true, uploads: true, withdrawals: false } },
  { code: 'ID', name: 'Indonesia', countries: ['ID'], currency: 'idr', defaultLanguage: 'id', languages: ['id', 'en'], timezone: 'Asia/Jakarta', active: false, sort: 4, features: {} },
  { code: 'MY', name: 'Malaysia', countries: ['MY'], currency: 'myr', defaultLanguage: 'ms', languages: ['ms', 'en'], timezone: 'Asia/Kuala_Lumpur', active: false, sort: 5, features: {} },
  { code: 'TR', name: 'Türkiye', countries: ['TR'], currency: 'try', defaultLanguage: 'tr', languages: ['tr', 'en'], timezone: 'Europe/Istanbul', active: false, sort: 6, features: {} },
  { code: 'GULF', name: 'Gulf', countries: ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'], currency: 'aed', defaultLanguage: 'ar', languages: ['ar', 'ur', 'en', 'hi'], timezone: 'Asia/Dubai', active: false, sort: 7, features: {} },
  { code: 'PH', name: 'Philippines', countries: ['PH'], currency: 'php', defaultLanguage: 'fil', languages: ['fil', 'en'], timezone: 'Asia/Manila', active: false, sort: 8, features: {} },
  { code: 'NP', name: 'Nepal', countries: ['NP'], currency: 'npr', defaultLanguage: 'ne', languages: ['ne', 'en', 'hi'], timezone: 'Asia/Kathmandu', active: false, sort: 9, features: {} },
  { code: 'GLOBAL', name: 'Global', countries: [], currency: 'usd', defaultLanguage: 'en', languages: ['en', 'ur', 'hi', 'bn'], timezone: 'UTC', active: true, sort: 99, features: { pk_battles: true, uploads: true, withdrawals: false } },
];

export const GLOBAL_REGION = 'GLOBAL';

/** Pure: the active region listing the country, else GLOBAL (mirrors private.region_for_country). */
export function regionForCountry(regions: Pick<Region, 'code' | 'countries' | 'active' | 'sort'>[], country: string | null | undefined): string {
  if (!country) return GLOBAL_REGION;
  const cc = country.toUpperCase();
  const match = regions
    .filter((r) => r.active && r.code !== GLOBAL_REGION && r.countries.includes(cc))
    .sort((a, b) => a.sort - b.sort)[0];
  return match?.code ?? GLOBAL_REGION;
}

/** Edge geo header (CloudFront / Cloudflare), else the device region the app sent. */
export function signupCountryFrom(headers: Record<string, string | string[] | undefined>, deviceRegion?: string | null): string | null {
  const header = headers['cloudfront-viewer-country'] ?? headers['cf-ipcountry'];
  const edge = (Array.isArray(header) ? header[0] : header)?.toUpperCase();
  if (edge && /^[A-Z]{2}$/.test(edge) && edge !== 'XX' && edge !== 'T1') return edge;
  const device = deviceRegion?.toUpperCase();
  return device && /^[A-Z]{2}$/.test(device) ? device : null;
}

/**
 * Regional variants (translated from 20260925030000_regions_events.sql). A
 * user's region comes from User.signupCountry — recorded once at sign-up and
 * never client-editable — not from the editable User.country, so pricing
 * can't be gamed by editing a profile.
 */
@Injectable()
export class RegionsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts missing regions; never overwrites an owner's edits. */
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    for (const r of REGION_SEED) {
      await this.prisma.region.upsert({ where: { code: r.code }, create: r, update: {} });
    }
  }

  list() {
    return this.prisma.region.findMany({ orderBy: { sort: 'asc' } });
  }

  async userRegion(userId: string | null | undefined, tx: Prisma.TransactionClient = this.prisma): Promise<string> {
    const [user, regions] = await Promise.all([
      userId ? tx.user.findUnique({ where: { id: userId }, select: { signupCountry: true } }) : null,
      tx.region.findMany({ where: { active: true }, select: { code: true, countries: true, active: true, sort: true } }),
    ]);
    return regionForCountry(regions, user?.signupCountry);
  }

  async myRegion(userId: string | null | undefined) {
    return this.prisma.region.findUniqueOrThrow({ where: { code: await this.userRegion(userId) } });
  }
}
