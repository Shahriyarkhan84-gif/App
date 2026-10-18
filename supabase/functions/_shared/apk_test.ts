import { isExpoApkUrl } from './apk.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}

Deno.test('accepts an EAS artifact APK link', () => {
  assertEquals(isExpoApkUrl('https://expo.dev/artifacts/eas/Zdy6kiGBlSXaD2_7-vFTbLEH8EvBoJtRq2-AdyZkQ20.apk'), true);
});

Deno.test('rejects other hosts, paths and file types', () => {
  assertEquals(isExpoApkUrl('https://evil.example/artifacts/eas/abc.apk'), false);
  assertEquals(isExpoApkUrl('https://expo.dev.evil.example/artifacts/eas/abc.apk'), false);
  assertEquals(isExpoApkUrl('https://expo.dev/artifacts/eas/abc.aab'), false);
  assertEquals(isExpoApkUrl('https://expo.dev/artifacts/eas/../x.apk'), false);
  assertEquals(isExpoApkUrl('http://expo.dev/artifacts/eas/abc.apk'), false);
  assertEquals(isExpoApkUrl(undefined), false);
});

