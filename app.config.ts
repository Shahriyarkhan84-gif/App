/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

import type { Brand } from './src/lib/brand.types';

/**
 * White-label build config. app.json holds everything shared by every client's app; this file
 * swaps in one brand from `brands/<id>/brand.json` (name, ids, icons, permission wording) and
 * hands the brand to the app as `extra.brand`. Pick the brand with BRAND=<id> (default: zynalive),
 * e.g. `BRAND=acme npx eas-cli build --profile production`.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const id = process.env.BRAND || 'zynalive';
  const file = path.join(__dirname, 'brands', id, 'brand.json');
  if (!fs.existsSync(file)) throw new Error(`Unknown BRAND "${id}": ${file} not found`);
  const brand = JSON.parse(fs.readFileSync(file, 'utf8')) as Brand;
  const a = brand.assets;
  // Permission prompts and other native strings in app.json say "Zynalive"; use the brand's name.
  const rename = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/Zynalive/g, brand.name.replace(/["\\]/g, '')));

  const plugins = rename(config.plugins ?? []).map((p): string | [string, unknown] =>
    Array.isArray(p) && p[0] === 'expo-splash-screen' ? [p[0], { ...(p[1] as object), image: a.splash }] : (p as string | [string, unknown]),
  );

  return {
    ...config,
    name: brand.name,
    slug: brand.app.slug,
    scheme: brand.app.scheme,
    icon: a.icon,
    owner: brand.app.easOwner,
    ios: { ...rename(config.ios), bundleIdentifier: brand.app.iosBundleId },
    android: {
      ...config.android,
      package: brand.app.androidPackage,
      adaptiveIcon: { ...config.android?.adaptiveIcon, foregroundImage: a.androidForeground, backgroundImage: a.androidBackground, monochromeImage: a.androidMonochrome },
    },
    web: { ...config.web, favicon: a.favicon },
    plugins,
    updates: { ...config.updates, url: `https://u.expo.dev/${brand.app.easProjectId}` },
    extra: { ...config.extra, brand, eas: { projectId: brand.app.easProjectId } },
  };
};
