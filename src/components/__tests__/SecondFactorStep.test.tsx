import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import SignInScreen from '../../app/(auth)/sign-in';

// A correct password on a new device: Clerk asks for a code emailed to the user.
const mockSignIn = {
  supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'idn_1', safeIdentifier: 'a***@example.com' }],
  create: jest.fn(async () => ({ status: 'needs_second_factor', createdSessionId: null })),
  prepareSecondFactor: jest.fn(),
  attemptSecondFactor: jest.fn(async () => ({ status: 'complete', createdSessionId: 'sess_1' })),
};
const mockSetActive = jest.fn();

jest.mock('@clerk/clerk-expo', () => ({
  useSignIn: () => ({ isLoaded: true, signIn: mockSignIn, setActive: mockSetActive }),
  useClerk: () => ({ session: null }),
  useAuth: () => ({ isSignedIn: false }),
  useSSO: () => ({ startSSOFlow: jest.fn() }),
  isClerkAPIResponseError: () => false,
}));
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return { router: { replace: jest.fn(), push: jest.fn() }, Link: ({ children }: { children: unknown }) => <Text>{children}</Text> };
});
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn(), warmUpAsync: jest.fn(), coolDownAsync: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

it('asks for the emailed code after the password and signs in with it', async () => {
  await render(<SignInScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'a@example.com');
  await fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'Secret!2026');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

  // No dead end: the code step opens and the code is emailed once.
  expect(screen.getByText('Check your email')).toBeTruthy();
  expect(screen.queryByText(/use the web app/i)).toBeNull();
  expect(mockSignIn.prepareSecondFactor).toHaveBeenCalledTimes(1);
  expect(mockSignIn.prepareSecondFactor).toHaveBeenCalledWith({ strategy: 'email_code', emailAddressId: 'idn_1' });

  await fireEvent.changeText(await screen.findByLabelText('Verification code, 6 digits'), '424242');
  expect(mockSignIn.attemptSecondFactor).toHaveBeenCalledWith({ strategy: 'email_code', code: '424242' });
  expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_1' });
  expect(router.replace).toHaveBeenCalledWith('/');
});
