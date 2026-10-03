# How to build Zynalive: the three roadmaps applied

Frontend, Backend and Full Stack roadmaps for 2026, mapped onto this repo. Each step says what Zynalive uses instead, where it lives, what is done, and what to build next. Product-level status is in `REMAINING_WORK.md`; this page is the "in what order, and how" view.

Legend: ✅ done · 🟡 partly done · ⬜ not started.

## Frontend roadmap (HTML → CSS → JavaScript → React → Tailwind)

Zynalive is a React Native app (Expo), so the web steps become their app equivalents.

| Step | Roadmap says | In Zynalive | Where | Status | Build next |
|---|---|---|---|---|---|
| 01 | HTML: structure the web | Screens are routes, built from React Native views | `src/app/` (Expo Router: one file = one screen) | ✅ | Public web pages stay plain HTML (`/privacy`, `/account-deletion`) |
| 02 | CSS: style and design | Theme tokens + shared components, no per-screen colors | `src/lib/theme.ts`, `src/components/ui.tsx` | ✅ | Move the remaining hardcoded colors (gradients on Explore tiles) into theme tokens |
| 03 | JavaScript: make it interactive | TypeScript everywhere (typecheck is part of "done") | `src/**/*.ts(x)` | ✅ | Keep strict mode on; no `any` in money or auth code |
| 04 | React: build modern UI | Components + hooks; every screen handles 7 states | `src/components/StateView.tsx`, `src/lib/hooks.ts` | ✅ | Multi-guest party rooms, likes, host dashboard (the design canvas screens still missing) |
| 05 | Tailwind: style faster (optional) | Not used. The theme file plays that role | `src/lib/theme.ts` | ➖ skip | Only worth it for the Next.js web dashboards (`apps/web`) |

Ideas to build on the frontend:

1. **Haptics, motion and the logo animation are done**; next is a shared `<Skeleton>` loader so lists don't flash empty.
2. **Localization**: move the remaining English strings into `src/lib/i18n/en.ts` as screens are touched (Urdu, Hindi and Bengali already exist).
3. **Tests**: add component tests for the shared `Button`, `Chip` and tab bar, then end-to-end flows with Maestro (join → chat → gift → leave).

## Backend roadmap (JavaScript → Node.js → Database → APIs → Auth → Deployment)

There are two backends in this repo. The live one is Supabase; the NestJS one is the planned migration (`MIGRATION_PLAN.md`).

| Step | Roadmap says | Live (Supabase) | Planned (NestJS) | Status | Build next |
|---|---|---|---|---|---|
| 01 | JavaScript basics | TypeScript (edge functions run on Deno) | TypeScript | ✅ | none |
| 02 | Node.js: the server | Edge functions in `supabase/functions/` | `apps/api` (NestJS) | ✅ / 🟡 | Point the media worker at `apps/api` |
| 03 | Database | Postgres with row-level security | Prisma + PostgreSQL, `packages/database` | ✅ | Add the missing owner and agency screens' queries |
| 04 | APIs | Database functions (RPCs) for money, roles, moderation; edge functions for webhooks | REST + Socket.IO in `apps/api` | ✅ | Local payment rails (JazzCash, Easypaisa) |
| 05 | Authentication | Clerk sign-in, its token signs database access | JWT + refresh tokens + OTP + 2FA in `apps/api` | ✅ | Push notifications (`expo-notifications`) and SMS |
| 06 | Deployment | Supabase migrations, EAS builds, CI in `.github/workflows/ci.yml` | Docker + Kubernetes plan | 🟡 | Install `expo-updates` once, then ship changes over the air; set up Play Billing for Android coin purchases |

Rules that stay in force at every backend step (from `AGENTS.md`): never trust the client for roles, balances, prices or payment success; coins are credited only from the verified Stripe webhook; every schema change gets row-level security and a test in `supabase/tests/10_must_pass.sql`.

## Full Stack roadmap (Frontend → Backend → Database → APIs → Deployment)

| Step | Roadmap says | Zynalive's version | Status |
|---|---|---|---|
| 01 | Frontend: HTML, CSS, JS, a framework | Expo app (`src/`) plus Next.js dashboards (`apps/web`) | ✅ app · 🟡 dashboards |
| 02 | Backend: build the server and logic | Supabase functions and RPCs today; NestJS next | ✅ |
| 03 | Database: store and manage data | Postgres, about 48 tables, all with RLS | ✅ |
| 04 | APIs: connect frontend and backend | Supabase client in the app; REST API ready in `apps/api` | ✅ / 🟡 (app still on Supabase) |
| 05 | Deployment: deploy and make it live | EAS builds, web export, Supabase | 🟡 |

**Learn → Build → Deploy → Grow**, applied:

- **Learn:** read `docs/ARCHITECTURE.md` first, then `docs/MIGRATION_PLAN.md`.
- **Build:** pick the next gap from `REMAINING_WORK.md`. The biggest are the Agency and Owner web dashboards, push notifications, and the party rooms from the design canvas.
- **Deploy:** run `npm run typecheck`, `npm run lint`, `npm run build:web`, `bash supabase/tests/run.sh`, then `cd agents && pytest`; build with EAS; ship later changes over the air.
- **Grow:** analytics already feed the AI CEO's KPIs; add ARPU/LTV once there is marketing spend data, and the SEO/marketing AI (not started).

## Suggested build order from here

1. **Ship what exists:** one Android build with `expo-updates` baked in (the Free-plan build limit reset on Oct 1), then deliver changes over the air.
2. **Push notifications:** closes the biggest gap in "Notifications" (product 14) and keeps viewers coming back.
3. **Multi-guest party rooms and likes:** the largest missing screens from the design canvas.
4. **Agency web dashboard (9 sections):** unlocks the agency business and agent recruitment.
5. **Owner web dashboard (14 sections):** moves daily operations off the in-app command center.
6. **Local payment rails (JazzCash/Easypaisa):** the main revenue lever for the South Asia market; needs the coin-to-PKR rate decided first.
7. **Move the app to the NestJS API** screen by screen, as laid out in `MIGRATION_PLAN.md` phase 8.
