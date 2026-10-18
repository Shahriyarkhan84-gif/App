/** Only EAS build artifacts can be published as the website's APK. */
export function isExpoApkUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/expo\.dev\/artifacts\/eas\/[A-Za-z0-9_-]+\.apk$/.test(value);
}

