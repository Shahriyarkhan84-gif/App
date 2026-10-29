# Zynalive

South-Asia-first live streaming and social platform: Expo app (iOS, Android,
web), Postgres/Supabase backend, LiveKit video, a coin & gift economy, and an
AI system that runs in the background as **LangGraph** agents powered by Claude.

```
App (Expo) ──> Supabase (Postgres + RLS + RPCs + Realtime + Edge Functions) <── agents/ (LangGraph worker)
     └──> LiveKit (WebRTC)          Stripe · Clerk · Upstash · Resend · PostHog · Sentry · ProductBridge
```

| Where | What |
|---|---|
| `src/` | Expo Router app — Home · Party · Go live · Messages · Me, rankings, live room, host broadcast, wallet, earnings, DMs, support, Owner command center |
| `supabase/migrations/` | Schema, RLS, money/moderation RPCs |
| `supabase/functions/` | `livekit-token`, `livekit-webhook`, `coins-checkout`, `stripe-webhook`, `clerk-webhook`, `didit-session`, `didit-webhook`, `delete-account` |
| `supabase/tests/` | Must-pass security & financial tests (`run.sh`) |
| `agents/` | LangGraph worker: AI CEO (Finance · Economy · Streaming AI), moderation, fraud, support, creator assist, translation, recommendations |
| `docs/` | [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Economy](docs/ECONOMY.md) · [Security](docs/SECURITY.md) · [AI](docs/AI.md) · [Environment](docs/ENVIRONMENT.md) · [Remaining work](docs/REMAINING_WORK.md) · [Changelog](docs/CHANGELOG.md) |

## Tests

| Command | What |
|---|---|
| `npm run typecheck && npm run lint` | App |
| `npm run build:web` | Web export |
| `bash supabase/tests/run.sh` | Schema + RLS + must-pass financial/security tests (non-root, needs Postgres binaries) |
| `cd agents && TEST_DATABASE_URL=postgresql://… pytest` | Every LangGraph graph against real Postgres with a fake LLM |
| `cd supabase/functions && deno check */index.ts` | Edge functions |

CI runs all of the above (`.github/workflows/ci.yml`).

## Deploy

Step-by-step for every piece (Supabase, Vercel, Render, Expo): [docs/HOSTING.md](docs/HOSTING.md).

- **Web → Vercel**: `vercel.json` is ready (static `expo export`). Set `EXPO_PUBLIC_*` vars.
- **Workers → Render**: `render.yaml` Blueprint (AI agents + media), next to the database in us-east.
- **Domain**: Namecheap → Cloudflare DNS → Vercel (`A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com`, DNS-only).
- **Android**: `npx eas-cli@latest build --platform android --profile preview` (APK) or `production` (AAB for Play Console).
- **iOS**: `--platform ios --profile production`, then `eas submit`.
