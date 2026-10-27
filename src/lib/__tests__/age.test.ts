import { parseBirthDate } from '../age';

describe('parseBirthDate', () => {
  it('accepts a real date', () => {
    expect(parseBirthDate('14', '8', '1999')).toBe('1999-08-14');
  });
  it('rejects impossible dates', () => {
    expect(parseBirthDate('31', '2', '2000')).toBeNull();
    expect(parseBirthDate('0', '1', '2000')).toBeNull();
    expect(parseBirthDate('1', '13', '2000')).toBeNull();
  });
  it('rejects the future and years before 1900', () => {
    expect(parseBirthDate('1', '1', String(new Date().getFullYear() + 1))).toBeNull();
    expect(parseBirthDate('1', '1', '1850')).toBeNull();
  });
});
