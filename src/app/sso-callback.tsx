import { useAuth, useClerk, useSignUp } from '@clerk/clerk-expo';
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
  const { signUp } = useSignUp();
  const clerk = useClerk();
  const needsMoreInfo = signUp?.status === 'missing_requirements';

  useEffect(() => {
    if (!isLoaded) return;
    // Session already active (SocialButtons' own setActive + redirect usually
    // gets here first) — push home rather than wait on Stack.Protected.
    if (isSignedIn) {
      router.replace('/');
      return;
    }
    // New account the Clerk instance wants more fields for (username, phone…).
    if (needsMoreInfo) {
      router.replace('/complete-sign-up');
      return;
    }
    // Otherwise sign-in didn't complete (cancelled, failed, or the redirect never
    // carried a session back — see AuthForm.tsx's start()) — don't strand the user
    // on a spinner forever; send them back with a visible reason after a few seconds.
    const t = setTimeout(() => {
      // A session held on a Clerk task (e.g. choose an organization) never counts as signed in.
      const notice = clerk.session?.currentTask ? 'pending_task' : 'sso_timeout';
      if (!isSignedIn) router.replace({ pathname: '/welcome', params: { notice } });
    }, 6000);
    return () => clearTimeout(t);
  }, [isLoaded, isSignedIn, needsMoreInfo, clerk]);

  return <StateView state={{ kind: 'loading' }} />;
}
