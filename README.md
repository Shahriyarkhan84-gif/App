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

## Quick start

```bash
npm install
cp .env.example .env                       # see docs/ENVIRONMENT.md
npm run web                                # web works immediately
npx eas-cli@latest build --profile development --platform android   # native dev build (LiveKit needs native modules)
```

### Backend

1. **Clerk**: create an app, enable Email/Google/Apple, activate the Supabase
   integration, and add a webhook → `…/functions/v1/clerk-webhook`.
2. **Supabase**: add Clerk under Authentication → Third-party auth, then:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   npx supabase secrets set CLERK_ISSUER=… LIVEKIT_URL=… LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… \
     STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… SITE_URL=… UPSTASH_REDIS_REST_URL=… \
     UPSTASH_REDIS_REST_TOKEN=… RESEND_API_KEY=… EMAIL_FROM=… CLERK_WEBHOOK_SECRET=…
   npx supabase functions deploy
   ```
3. **LiveKit** (Cloud or self-hosted): add a webhook → `…/functions/v1/livekit-webhook`.
4. **Stripe**: webhook → `…/functions/v1/stripe-webhook` for
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
5. **First owner**: sign up in the app, then in the SQL editor
   `update profiles set role = 'SUPER_ADMIN' where id = '<your clerk user id>';`
6. **Didit** (host identity verification): see [docs/HOST_VERIFICATION.md](docs/HOST_VERIFICATION.md).
7. **Set the coin → PKR withdrawal rate** in Profile → Owner command center → Settings.

### AI agents (background)

```bash
cd agents && cp .env.example .env          # DATABASE_URL, ANTHROPIC_API_KEY
pip install -e . && python -m zynalive_agents
```

Deploy `agents/Dockerfile` as an always-on service (Fly.io, Railway, Render…).
Details, schedules and cost levers: [docs/AI.md](docs/AI.md).

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

- **Web → Vercel**: `vercel.json` is ready (static `expo export`). Set `EXPO_PUBLIC_*` vars.
- **Domain**: Namecheap → Cloudflare DNS → Vercel (`A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com`, DNS-only).
- **Android**: `npx eas-cli@latest build --platform android --profile preview` (APK) or `production` (AAB for Play Console).
- **iOS**: `--platform ios --profile production`, then `eas submit`.
