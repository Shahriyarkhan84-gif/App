# AI system (LangGraph, background)

The `agents/` package is a long-running Python worker. It uses **LangGraph** for
orchestration and calls **Claude** through the official `anthropic` SDK with
structured outputs (every node gets a validated Pydantic object, never free
text). Default model `claude-opus-5` with adaptive thinking and server-side
refusal fallbacks; override per branch with `AI_MODEL_<BRANCH>`.

## Graphs

| Branch | Trigger | Graph | Automatic effect | Needs owner approval |
|---|---|---|---|---|
| 🧠 AI CEO | every `AI_CEO_EVERY_MIN` (60) or "Run now" | `collect_kpis → {finance_ai ∥ economy_ai ∥ streaming_ai} → ceo_synthesize → publish` | `ai_reports` briefing + owner notification | — (recommends only) |
| 🤖 Moderation (chat) | every chat message (`platform_settings.ai_moderation.mode = all`) | `load → rules → classify → act` | hide message + warning; welfare escalation for self-harm | temp restriction / ban proposals |
| 🤖 Moderation (reports) | every report | `load → assess → act` | report → `reviewing` with AI assessment; confident warnings | ladder actions |
| 🤖 Fraud detection | every `AI_FRAUD_EVERY_MIN` (30) | `collect_signals (SQL) → assess → propose` | none | freeze wallet / account review / temp ban |
| 🤖 Support | every ticket | `load → draft → respond` | answer or escalate | — |
| 🤖 Creator assist | stream ends | `load → coach → save` | `streams.ai_summary` + host notification | — |
| 🤖 Translation | user taps Translate | `load → translate` | cached `message_translations` | — |
| 🤖 Recommendations | every `AI_RECS_EVERY_MIN` (15) | `score` (SQL, no model) | `user_recommendations` ("For you" row) | — |
| 🤖 Subtitles | — | not built (needs speech-to-text on LiveKit egress) | — | — |

Fraud signals: circular gifting between two accounts, ≥95% of spend to one
host, new accounts with large purchases, repeated refunds/disputes, purchase
velocity. Only flagged accounts reach the model.

## Runtime

- Queue: `ai_jobs` (enqueued by Postgres RPCs), claimed with `FOR UPDATE SKIP
  LOCKED` so you can run several replicas. Failures retry with exponential
  backoff (5 attempts); refusals fail immediately; stuck jobs are requeued.
- Schedules are enqueued with a per-time-bucket `dedupe_key`, so replicas don't
  double-run the CEO briefing.
- Approved `ai_actions` are executed by the worker via `internal_execute_ai_action`.

## Run

```bash
cd agents
cp .env.example .env              # DATABASE_URL, ANTHROPIC_API_KEY
pip install -e .
python -m zynalive_agents         # or: docker build -t zynalive-agents . && docker run --env-file .env zynalive-agents
```

Deploy as an always-on service (Fly.io, Railway, Render, ECS…). Vercel
serverless functions can't host a persistent worker.

## Cost

Chat moderation runs once per chat message, so it dominates spend. Levers, in
order: set `ai_moderation.mode` to something other than `all` (only reports are
then reviewed), lower effort (already `low` for chat and translation), or set
`AI_MODEL_MODERATION` / `AI_MODEL_TRANSLATION` to a cheaper model after
checking quality on real traffic.

## Tests

`agents/tests` run every graph against a real Postgres with the migrations
applied and a deterministic fake LLM (`TEST_DATABASE_URL=... pytest`).
