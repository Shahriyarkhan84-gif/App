import { BadRequestException } from '@nestjs/common';

import { PaymentsService } from '../payments/payments.service';
import { REGION_SEED, regionForCountry, RegionsService, signupCountryFrom } from './regions.service';

/** Mirrors the region cases in supabase/tests/95_regions_events.sql and 10_must_pass.sql §4b. */
describe('regions', () => {
  it('maps a sign-up country to its active market, else Global', () => {
    expect(regionForCountry(REGION_SEED, 'PK')).toBe('PK');
    expect(regionForCountry(REGION_SEED, 'in')).toBe('IN');
    expect(regionForCountry(REGION_SEED, 'GB')).toBe('GLOBAL'); // UK → global
    expect(regionForCountry(REGION_SEED, 'ID')).toBe('GLOBAL'); // Indonesia not launched yet
    expect(regionForCountry(REGION_SEED, null)).toBe('GLOBAL');
    const launched = REGION_SEED.map((r) => (r.code === 'ID' ? { ...r, active: true } : r));
    expect(regionForCountry(launched, 'ID')).toBe('ID');
  });

  it('takes the sign-up country from the edge header, else the device region', () => {
    expect(signupCountryFrom({ 'cloudfront-viewer-country': 'pk' }, 'IN')).toBe('PK');
    expect(signupCountryFrom({ 'cf-ipcountry': 'BD' })).toBe('BD');
    expect(signupCountryFrom({ 'cf-ipcountry': 'XX' }, 'in')).toBe('IN'); // unknown edge value
    expect(signupCountryFrom({}, 'not-a-country')).toBeNull();
  });

  describe('regional pricing in PaymentsService.createPayment', () => {
    function build(signupCountry: string | null, pkgRegion: string) {
      const prisma = {
        coinPackage: { findFirst: jest.fn().mockResolvedValue({ id: 7, regionCode: pkgRegion, coins: 140n, priceMinor: 7900n, currency: 'inr' }) },
        user: {
          findUnique: jest.fn().mockResolvedValue({ signupCountry }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', status: 'active' }),
        },
        region: { findMany: jest.fn().mockResolvedValue(REGION_SEED) },
        payment: { create: jest.fn().mockImplementation(({ data }) => ({ id: 'pay_1', ...data })) },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const regions = new RegionsService(prisma as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { service: new PaymentsService(prisma as any, {} as any, regions), prisma };
    }

    it('refuses a package from another region (a PK buyer cannot buy INR pricing)', async () => {
      const { service, prisma } = build('PK', 'IN');
      await expect(service.createPayment('u1', 7)).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('refuses regional packages to buyers with no recorded sign-up country (Global)', async () => {
      const { service } = build(null, 'PK');
      await expect(service.createPayment('u1', 7)).rejects.toThrow('invalid_package');
    });

    it('prices from the package in the buyer’s own region', async () => {
      const { service } = build('IN', 'IN');
      await expect(service.createPayment('u1', 7)).resolves.toMatchObject({ amountMinor: 7900n, currency: 'inr', coins: 140n });
    });
  });
});
