import { Platform } from 'react-native';

/** The iPhone install profile built by scripts/ios-profile.mjs (a Web Clip for the Home Screen). */
export const IOS_PROFILE_PATH = '/ios.mobileconfig';

/**
 * True in a browser on iPhone or iPad that isn't already running from the Home Screen.
 * iPadOS Safari reports itself as a Mac, so a Mac with a touch screen counts as an iPad.
 */
export function canInstallIosProfile(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/** Profiles can only be installed from Safari; other iPhone browsers (Chrome, Firefox, in-app) can't. */
export function isIosSafari(): boolean {
  return typeof navigator !== 'undefined' && !/CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram/.test(navigator.userAgent);
}
