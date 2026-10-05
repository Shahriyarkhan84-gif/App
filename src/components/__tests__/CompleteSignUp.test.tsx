import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import CompleteSignUpScreen from '../../app/(auth)/complete-sign-up';

// A Google sign-up the Clerk instance wants a username and phone number for.
const mockSignUp = {
  status: 'missing_requirements',
  missingFields: ['username', 'phone_number'],
  unverifiedFields: [] as string[],
  emailAddress: 'a@example.com',
  createdSessionId: null as string | null,
  update: jest.fn(),
  preparePhoneNumberVerification: jest.fn(),
  attemptPhoneNumberVerification: jest.fn(),
  prepareEmailAddressVerification: jest.fn(),
  attemptEmailAddressVerification: jest.fn(),
};
const mockSetActive = jest.fn();

jest.mock('@clerk/clerk-expo', () => ({
  useSignUp: () => ({ isLoaded: true, signUp: mockSignUp, setActive: mockSetActive }),
  useClerk: () => ({ client: { signUp: mockSignUp }, session: null }),
  useAuth: () => ({ isSignedIn: false }),
  useSSO: () => ({ startSSOFlow: jest.fn() }),
  isClerkAPIResponseError: () => false,
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn(), warmUpAsync: jest.fn(), coolDownAsync: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignUp.unverifiedFields = [];
  mockSignUp.status = 'missing_requirements';
});

it('asks only for the fields Clerk is missing', async () => {
  await render(<CompleteSignUpScreen />);
  expect(screen.getByText('Finish your profile')).toBeTruthy();
  expect(screen.getByPlaceholderText('8–20 characters')).toBeTruthy();
  expect(screen.getByPlaceholderText('+92 300 1234567')).toBeTruthy();
  expect(screen.queryByText('Password')).toBeNull();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  // Usernames shorter than Clerk's 8-character minimum keep Continue disabled.
  await fireEvent.changeText(screen.getByPlaceholderText('8–20 characters'), 'short');
  await fireEvent.changeText(screen.getByPlaceholderText('+92 300 1234567'), '+923001234567');
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
});

it('saves the details, then asks for the SMS code', async () => {
  mockSignUp.update.mockImplementation(async () => {
    mockSignUp.unverifiedFields = ['phone_number'];
  });
  await render(<CompleteSignUpScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('8–20 characters'), ' zyna_fan ');
  await fireEvent.changeText(screen.getByPlaceholderText('+92 300 1234567'), '+923001234567');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

  expect(mockSignUp.update).toHaveBeenCalledWith({ username: 'zyna_fan', phoneNumber: '+923001234567' });
  expect(mockSignUp.preparePhoneNumberVerification).toHaveBeenCalledWith({ strategy: 'phone_code' });
  expect(await screen.findByText('Check your messages')).toBeTruthy();
});

it('signs in once the code completes the sign-up', async () => {
  mockSignUp.update.mockImplementation(async () => {
    mockSignUp.unverifiedFields = ['phone_number'];
  });
  mockSignUp.attemptPhoneNumberVerification.mockImplementation(async () => {
    mockSignUp.status = 'complete';
    mockSignUp.createdSessionId = 'sess_1';
  });
  await render(<CompleteSignUpScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('8–20 characters'), 'zyna_fan');
  await fireEvent.changeText(screen.getByPlaceholderText('+92 300 1234567'), '+923001234567');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(await screen.findByPlaceholderText('123456'), '424242');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify & continue' }));

  expect(mockSignUp.attemptPhoneNumberVerification).toHaveBeenCalledWith({ code: '424242' });
  expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_1' });
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(router.replace).not.toHaveBeenCalledWith('/welcome');
});

it('sends you back to the start when there is nothing to finish', async () => {
  mockSignUp.status = null as unknown as string;
  await render(<CompleteSignUpScreen />);
  expect(router.replace).toHaveBeenCalledWith('/welcome');
});
