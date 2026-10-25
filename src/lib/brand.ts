import Constants from 'expo-constants';

import zynalive from '../../brands/zynalive/brand.json';

import type { Brand, Feature } from './brand.types';

export type { Brand, Feature, ThemePreset } from './brand.types';

/**
 * The brand this build was made for: app.config.ts puts brands/<BRAND>/brand.json into
 * `extra.brand`. Tests and tools without an Expo config fall back to Zynalive.
 */
export const brand: Brand = (Constants.expoConfig?.extra?.brand as Brand | undefined) ?? (zynalive as Brand);

/** Whether this brand's app has a feature switched on. Off features are hidden everywhere in the app. */
export function hasFeature(feature: Feature): boolean {
  return brand.features[feature] !== false;
}
