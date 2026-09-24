import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

// Signed-out users land on the welcome screen first.
export const unstable_settings = { initialRouteName: 'welcome' };

export default function AuthLayout() {
  const { c } = useTheme();
  return (
    <Stack
      initialRouteName="welcome"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: c.background },
      }}
    />
  );
}
