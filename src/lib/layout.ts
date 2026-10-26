import { Platform, useWindowDimensions } from 'react-native';

/** Width of the left sidebar that replaces the bottom tab bar on computers. */
export const SIDEBAR_WIDTH = 248;

/** A computer-sized browser window: the app shows a left sidebar instead of the phone tab bar. */
export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 1024;
}

/** Width available to a tab screen's content (the window minus the sidebar on computers). */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return useIsDesktop() ? width - SIDEBAR_WIDTH : width;
}
