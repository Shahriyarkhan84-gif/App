import { useAuth } from '@clerk/clerk-expo';
import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * zynalive.com/ is the public website (public/landing.html); signed-in visitors are sent here.
 * Sends people into the app: Home when signed in, the welcome screen when not. Home is
 * protected, so a signed-out visitor must not be redirected to "/".
 */
export default function OpenApp() {
  const { isSignedIn } = useAuth();
  useEffect(() => {
    // On the web, a signed-out visitor could stay on this empty route if the in-app redirect
    // doesn't run, so load the welcome screen as a full page instead.
    if (Platform.OS === 'web' && !isSignedIn) globalThis.location?.replace('/welcome');
  }, [isSignedIn]);
  return <Redirect href={isSignedIn ? '/' : '/welcome'} />;
}
