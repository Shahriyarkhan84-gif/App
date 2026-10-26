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

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const unitNames = brand.units ?? { spend: ['coin', 'coins'], earn: ['diamond', 'diamonds'] };

/**
 * The brand's names for its two units, for app text: `U.spend` "diamonds", `U.Spend` "Diamonds",
 * `U.spendOne` "diamond"; `U.earn` "beans", `U.Earn` "Beans", `U.earnOne` "bean". The database
 * keeps its own column names (coin_balance, …); only what people read changes.
 */
export const U = {
  spendOne: unitNames.spend[0], spend: unitNames.spend[1], SpendOne: cap(unitNames.spend[0]), Spend: cap(unitNames.spend[1]),
  earnOne: unitNames.earn[0], earn: unitNames.earn[1], EarnOne: cap(unitNames.earn[0]), Earn: cap(unitNames.earn[1]),
};

/** "1 diamond" / "1,250 diamonds" (or beans with `kind: 'earn'`). */
export function units(n: number, kind: 'spend' | 'earn' = 'spend') {
  const [one, many] = unitNames[kind];
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
