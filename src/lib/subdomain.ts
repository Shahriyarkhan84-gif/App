/**
 * creator.zynalive.com opens the creator dashboard and agency.zynalive.com the agency portal.
 * vercel.json sends "/" on those hosts to the screen; the app uses this when it lands on "/"
 * again after sign-in.
 */
export function subdomainHome(hostname: string | undefined): '/host/dashboard' | '/agency' | null {
  const sub = hostname?.toLowerCase().split('.')[0];
  if (sub === 'creator') return '/host/dashboard';
  if (sub === 'agency') return '/agency';
  return null;
}
