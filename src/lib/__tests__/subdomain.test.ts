import { subdomainHome } from '../subdomain';

describe('subdomainHome', () => {
  it('opens the creator dashboard and the agency portal on their subdomains', () => {
    expect(subdomainHome('creator.zynalive.com')).toBe('/host/dashboard');
    expect(subdomainHome('Agency.zynalive.com')).toBe('/agency');
  });

  it('leaves every other host alone', () => {
    expect(subdomainHome('zynalive.com')).toBeNull();
    expect(subdomainHome('www.zynalive.com')).toBeNull();
    expect(subdomainHome('creators.zynalive.com')).toBeNull();
    expect(subdomainHome(undefined)).toBeNull();
  });
});
