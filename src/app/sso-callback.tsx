import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { StateView } from '@/components/StateView';

// Google/Apple sign-in (SocialButtons in AuthForm.tsx) opens the OAuth sheet with
// redirectUrl: zynalive://sso-callback. Expo Router needs a real route at that path
// or the OS shows "Unmatched Route" instead of returning control to the app.
// startSSOFlow() already sets the Clerk session in AuthForm's own promise chain;
// this screen just has to exist so the deep link resolves, then get out of the way —
// Stack.Protected in _layout.tsx swaps to the signed-in stack once isSignedIn flips.
export default function SSOCallback() {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    // Session already active (SocialButtons' own setActive + redirect usually
    // gets here first) — push home rather than wait on Stack.Protected.
    if (isSignedIn) {
      router.replace('/');
      return;
    }
    // Otherwise sign-in didn't complete (cancelled, failed) — don't strand the
    // user on a spinner forever; send them back to sign in after a few seconds.
    const t = setTimeout(() => {
      if (!isSignedIn) router.replace('/welcome');
    }, 4000);
    return () => clearTimeout(t);
  }, [isLoaded, isSignedIn]);

  return <StateView state={{ kind: 'loading' }} />;
}
