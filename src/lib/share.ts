import { Platform, Share } from 'react-native';

import { Alert } from './alert';

/**
 * Opens the share sheet. Browsers without the Web Share API (most desktop browsers) made
 * React Native's Share reject, so the button did nothing; there the text is copied instead.
 * A cancelled share is not an error.
 */
export async function shareMessage(message: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof navigator.share !== 'function') {
      await navigator.clipboard.writeText(message);
      Alert.alert('Copied', 'Copied to your clipboard — paste it anywhere to share.');
      return;
    }
    await Share.share({ message });
  } catch {
    // Cancelled, or the clipboard was refused: nothing to do.
  }
}
