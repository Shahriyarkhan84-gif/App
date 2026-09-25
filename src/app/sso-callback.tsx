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
    // If sign-in didn't complete (cancelled, failed) within a few seconds, don't
    // strand the user on a spinner — send them back to sign in.
    if (!isLoaded) return;
    if (isSignedIn) return;
    const t = setTimeout(() => {
      if (!isSignedIn) router.replace('/welcome');
    }, 4000);
    return () => clearTimeout(t);
  }, [isLoaded, isSignedIn]);

  return <StateView state={{ kind: 'loading' }} />;
}
