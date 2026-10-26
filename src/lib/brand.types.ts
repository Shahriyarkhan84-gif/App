// Shape of brands/<id>/brand.json. Kept free of app imports so app.config.ts can use it at build time.

export type ThemePreset = 'glass-sky' | 'midnight';

export type Feature = 'partyRooms' | 'pkBattles' | 'agencies' | 'events' | 'videos' | 'rankings' | 'frames';

export type Brand = {
  id: string;
  name: string;
  /** The wordmark in two parts; the second is drawn in the brand colour ("zyna" + "live"). */
  wordmark: [string, string];
  tagline: string;
  legalName: string;
  website: string;
  supportEmail: string;
  /** Default currency for prices shown before the server's own coin packs load. */
  currency: string;
  /**
   * Names of the two in-app units, [singular, plural], lower case: `spend` is what viewers buy and send
   * as gifts (Zynalive: diamonds), `earn` is what hosts receive and withdraw (Zynalive: beans).
   */
  units: { spend: [string, string]; earn: [string, string] };
  app: { slug: string; scheme: string; iosBundleId: string; androidPackage: string; easOwner: string; easProjectId: string };
  assets: { icon: string; splash: string; favicon: string; androidForeground: string; androidBackground: string; androidMonochrome: string };
  /** `primary` (a #RRGGBB colour) replaces the preset's main colour; the rest of the palette is kept. */
  theme: { preset: ThemePreset; primary?: string };
  features: Record<Feature, boolean>;
};
