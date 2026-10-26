# Selling the app to a client (white label)

One codebase, **a separate copy for each client**: their own app in the stores and their own backend
(Supabase, Clerk, Stripe, LiveKit, Didit). Users, money and data never mix between clients.

## What a brand controls

Everything brand-specific lives in `brands/<id>/brand.json` (types in `src/lib/brand.types.ts`):

| Field | What it changes |
|---|---|
| `name`, `wordmark`, `tagline` | App name on the phone, the logo text (second part in the brand colour), Welcome screen line. Every in-app mention of the name, share messages, Terms, Privacy and permission prompts. |
| `legalName`, `website`, `supportEmail` | Legal pages, share links (`<website>/live/<id>`), contact lines. |
| `currency` | Default currency shown before the server's coin packs load. |
| `app.*` | Store ids (`iosBundleId`, `androidPackage`), deep-link `scheme`, Expo `slug`, EAS owner and project id. |
| `assets.*` | App icon, Android adaptive icon layers, splash image, web favicon. Put the files in `brands/<id>/` and point to them. |
| `theme.preset` | The look. `glass-sky` (sky-blue background, frosted cards, deep-blue buttons; navy live rooms — Zynalive's default) or `midnight` (all dark: near-black screens, charcoal cards, light-violet buttons). |
| `theme.primary` | Optional `#RRGGBB`. Replaces the main colour (buttons, links, selected states) and works out the lighter/darker shades; the rest of the preset stays. |
| `features.*` | Turn off `partyRooms`, `pkBattles`, `agencies`, `events`, `videos`, `rankings`, `frames`. Off features disappear from tabs, menus, banners and notifications, and their screens can't be opened. |

Money settings are **not** in the brand file: coin packs and prices (`coin_packages`), gifts
(`gift_catalog`) and payout rules (`platform_settings`) live in the client's own database and are
edited in their Owner command center.

## How it works

- `app.config.ts` reads `BRAND` (default `zynalive`), loads that brand file, sets the native app
  name, ids, icons, splash and permission wording, and passes the brand to the app as `extra.brand`.
- `src/lib/brand.ts` exports `brand` and `hasFeature()`; `src/lib/theme.ts` builds the colours from
  `brand.theme` (`brandPalettes()`).
- Screens never hard-code the name or colours: use `brand.name` and `useTheme().c`.

## Adding a client

1. Copy `brands/zynalive` to `brands/<client>` and edit `brand.json` and the images.
2. Create the client's accounts: Supabase project, Clerk app, Stripe account, LiveKit project, Didit
   app, Expo/EAS project (put its id in `app.easProjectId`), Apple and Google developer accounts.
3. Run every migration in `supabase/migrations` on their Supabase, deploy all Edge Functions and set
   the secrets listed in `docs/ENVIRONMENT.md` with **their** keys.
4. Add EAS build profiles for the client with their `EXPO_PUBLIC_*` values, and build with
   `BRAND=<client> npx eas-cli build --profile <client-profile>`.
5. Check with `BRAND=<client> npx expo config --type public` that the name, ids and icons are theirs.

## Not brandable yet

- Feature switches hide features in the app only; the server doesn't block them yet (a client who
  turns a feature off should also leave it unused in their command center).
- Two looks (`midnight`, `glass-sky`); more presets can be added in `PRESETS` in `src/lib/theme.ts` (each says whether everyday screens are light or dark). A dark preset also gets a dark splash and status bar (`app.config.ts`, `appIsDark`).
- The marketing website (`site/`) and the Edge Functions' email/notification wording still say Zynalive.
