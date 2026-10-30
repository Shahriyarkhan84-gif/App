import { appleTokenFromHex } from '../iapTags';

// Reference values shared with supabase/functions/_shared/stores_test.ts (user id "user_test").
const HEX = '1df4da597cb708f791ba0a7ddf367358a648d735f1241e1896da4066d63fe486';

describe('appleTokenFromHex', () => {
  it('matches the server for the same account', () => {
    expect(appleTokenFromHex(HEX)).toBe('1df4da59-7cb7-48f7-91ba-0a7ddf367358');
  });
  it('is shaped like a version-4 UUID', () => {
    expect(appleTokenFromHex('f'.repeat(64))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
