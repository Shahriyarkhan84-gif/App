import { useAuth } from '@clerk/clerk-expo';
import { Redirect } from 'expo-router';

/**
 * zynalive.com/ is the public website (public/landing.html); its "Open Zynalive" buttons link
 * here. Sends people into the app: Home when signed in, the welcome screen when not. Home is
 * protected, so redirecting a signed-out visitor to "/" would leave them on this empty screen.
 */
export default function OpenApp() {
  const { isSignedIn } = useAuth();
  return <Redirect href={isSignedIn ? '/' : '/welcome'} />;
}
