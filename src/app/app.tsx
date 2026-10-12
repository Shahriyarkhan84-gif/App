import { Redirect } from 'expo-router';

/**
 * zynalive.com/ is the public website (public/landing.html); its "Open Zynalive" buttons link
 * here. Sends people into the app: Home when signed in, the welcome screen when not.
 */
export default function OpenApp() {
  return <Redirect href="/" />;
}
