# Zynalive team (Claude Code agents)

Built from the *ZynaLive Professional App Staff List*. Each role is a Claude Code agent in
`.claude/agents/<name>.md`. Ask for one by name, e.g. "Use the security-engineer agent to review payments",
or let Claude pick from the descriptions.

**Engineers** (can edit code and run checks) follow the definition of done in `AGENTS.md`.
**Advisors** (business, community, marketing, data) read the repo and write plans, policies and
drafts; they don't edit code and hand changes to an engineer agent.


## Core Team

| Agent | Kind | Use it for |
|---|---|---|
| `product-manager` — Product Manager | Advisor | turn an idea or complaint into a clear feature spec, prioritise the backlog, or decide what to build next. |
| `ui-ux-designer` — UI/UX Designer | Editor | design or review a screen flow, layout, accessibility or empty/error states. |
| `brand-designer` — Brand Designer | Advisor | logo, colours, app-store graphics, website look, gift/frame artwork briefs and brand voice. |
| `frontend-mobile-developer` — Frontend Mobile Developer | Engineer | build or fix app screens and components (Expo Router, React Native, web build). |
| `backend-developer` — Backend Developer | Engineer | Supabase Edge Functions, server APIs, webhooks (Stripe, Clerk, LiveKit, Didit) and server logic. |
| `database-engineer` — Database Engineer | Engineer | schema changes, migrations, RLS policies, RPCs, indexes and slow queries. |
| `devops-engineer` — DevOps Engineer | Engineer | Vercel website deploys, EAS builds, CI, environment variables, secrets and hosting. |
| `live-streaming-engineer` — Live Streaming Engineer | Engineer | LiveKit rooms, go-live, party seats, PK battles, recordings and video quality. |
| `ai-engineer` — AI Engineer | Engineer | the Python agents worker: AI CEO, moderation, fraud, recommendations, subtitles, smart search. |
| `qa-test-engineer` — QA/Test Engineer | Engineer | test a feature end to end, write missing tests, or reproduce a bug before it is fixed. |
| `security-engineer` — Security Engineer | Engineer | review a change or area for security: auth, RLS, payments, secrets, uploads, webhooks. |
| `app-analyst` — App Analyst | Analyst | analyse the whole app and write one ranked health report (`docs/reports/APP_ANALYSIS.md`); runs the checks but doesn't change code. |
| `technical-writer` — Technical Writer | Editor | write or update docs, the changelog, help articles, privacy/terms text or store listing copy. |

## Business

| Agent | Kind | Use it for |
|---|---|---|
| `ceo-founder` — CEO/Founder Advisor | Advisor | strategy, priorities across teams, launch readiness and big trade-offs. |
| `operations-manager` — Operations Manager | Advisor | day-to-day running: processes for support, moderation, withdrawals, host onboarding and on-call. |
| `finance-manager` — Finance Manager | Advisor | revenue, costs, coin pricing, gift splits, payouts, Stripe fees and forecasts. |
| `legal-compliance-officer` — Legal & Compliance Officer | Advisor | privacy, terms, store policies (Google Play billing, age rules), KYC/AML, PECA and payments law. |
| `hr-manager` — HR Manager | Advisor | hiring plans, job descriptions, interview questions, onboarding and team policies. |

## Community

| Agent | Kind | Use it for |
|---|---|---|
| `customer-support` — Customer Support | Advisor | draft replies to users, build FAQ/help content, or investigate a user complaint. |
| `host-manager` — Host Manager | Advisor | host onboarding, verification, earnings questions and growing host activity. |
| `agency-manager` — Agency Manager | Advisor | agencies: agency codes, recruiting hosts, agency portal, commissions and disputes. |
| `content-moderator` — Content Moderator | Advisor | review reported content, write moderation guidelines, or tune word filters. |
| `trust-safety` — Trust & Safety Lead | Advisor | safety policy, child safety, harassment, self-harm, illegal content and escalations. |
| `fraud-investigator` — Fraud Investigator | Advisor | investigate suspicious payments, chargebacks, gift farming, multi-accounting or withdrawals. |

## Marketing

| Agent | Kind | Use it for |
|---|---|---|
| `digital-marketing` — Digital Marketing Manager | Advisor | launch plans, campaigns, funnels and marketing calendars. |
| `social-media` — Social Media Manager | Advisor | social content plans, posts, captions and community management on TikTok, Instagram, Facebook, YouTube. |
| `seo-specialist` — SEO Specialist | Editor | improve how zynalive.com and the store listing show up in search. |
| `influencer-partnerships` — Influencer Partnerships Manager | Advisor | plan creator/influencer deals, outreach messages and partnership terms. |
| `performance-marketing` — Performance Marketing Manager | Advisor | paid ads, attribution, CPA/ROAS targets and budget allocation. |

## Revenue

| Agent | Kind | Use it for |
|---|---|---|
| `payment-engineer` — Payment Engineer | Engineer | Stripe checkout, webhooks, reconciliation, refunds, disputes, Google Play Billing and payouts. |
| `virtual-gift-manager` — Virtual Gift Manager | Advisor | plan the gift catalog, prices, animations, seasonal gifts and gift events. |
| `creator-success` — Creator Success Manager | Advisor | help hosts grow: coaching, stream ideas, schedules and earnings tips. |
| `vip-membership-manager` — VIP Membership Manager | Advisor | design the VIP monthly membership: perks, price, tiers and launch. |

## Data

| Agent | Kind | Use it for |
|---|---|---|
| `data-analyst` — Data Analyst | Advisor | answer questions with data: users, retention, revenue, gifts, hosts. |
| `bi-analyst` — Business Intelligence Analyst | Advisor | define KPIs and dashboards (DAU/MAU, retention, ARPU, LTV, ROAS) and their exact definitions. |
| `data-scientist` — Data Scientist | Advisor | recommendations, ranking, fraud scoring, churn prediction and experiments. |

## Notes

- Agents run with the tools listed in their file; advisors have no edit or shell access.
- No agent can see secret values or change live money data; owners approve anything heavy.
- Add or change a role by editing its file; keep this table in step.
