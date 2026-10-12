// Fails when the app gets a second installed copy of a package it already has.
// Two copies of React, React Native, an Expo module or another native module break the app at runtime
// (only one copy is linked into the phone build), so the existing copy must be reused:
// `npm dedupe`, or an `overrides` entry in package.json pointing at the app's own version.
// Run: npm run check:duplicates
import { readFileSync } from 'node:fs';

const CORE = /^(react|react-dom|react-native|expo|expo-.+|@expo\/.+|@react-native\/.+|@react-native-.+\/.+|react-native-.+|@livekit\/.+|@supabase\/.+|@clerk\/.+|@sentry\/react-native|posthog-react-native)$/;
// Known, intentional: react-native-web pins its own colour helper (web only, no native code).
const ALLOWED = new Set(['@react-native/normalize-colors']);

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')).packages;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const problems = [];

const copies = {};
for (const [path, info] of Object.entries(lock)) {
  // The separate apps/ and packages/ rewrite has its own dependency tree; only the phone/web app is checked.
  if (!path || path.startsWith('apps/') || path.startsWith('packages/') || info.link) continue;
  const name = path.split('node_modules/').pop();
  if (CORE.test(name) && !ALLOWED.has(name)) (copies[name] ??= []).push(`${path} (${info.version})`);
}
for (const [name, paths] of Object.entries(copies)) {
  if (paths.length > 1) problems.push(`${name} is installed ${paths.length} times:\n    ${paths.join('\n    ')}`);
}

const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
for (const name of Object.keys(pkg.dependencies ?? {})) {
  if (dev.has(name)) problems.push(`${name} is listed in both dependencies and devDependencies`);
}

if (problems.length) {
  console.error(`Duplicate packages (reuse the existing copy: npm dedupe, or an "overrides" entry):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('No duplicate app packages.');
