# Load test

`supabase/tests/load/run.sh` starts a throwaway Postgres with every migration, seeds viewers with
coins, live hosts (through the real `go_live`) and follows, then uses `pgbench` to send many
concurrent users through the busiest paths with row-level security on, as signed-in users.

```bash
su postgres -s /bin/bash -c "cd /tmp && bash supabase/tests/load/run.sh"        # defaults
su postgres -s /bin/bash -c "cd /tmp && USERS=20000 HOSTS=500 CLIENTS=100 DURATION=60 bash supabase/tests/load/run.sh"
```

Scenarios: Home/Party feed (top 200 live rooms + who you follow), a gift to a random host, every gift
to one host (a viral PK battle), live chat, and a 70/20/10 feed/chat/gift mix. Afterwards it checks
the money: every coin viewers lost is a recorded gift and no wallet is negative (the run fails otherwise).

It measures the **database only**. It does not include the phone-to-server network (the project is in
us-east-1, ~250 ms each way from Pakistan), PostgREST, Supabase Realtime fan-out, Edge Functions or
LiveKit video.

## Results — 2026-10-10

4-core / 16 GB container, Postgres 16, 5,000 viewers, 300 live hosts, 50 concurrent users, 30 s each.

| Scenario | Requests/s | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|
| Home feed (200 live rooms) | 1,817 | 25 ms | 53 ms | 68 ms | 0 |
| Send gift (random host) | 2,046 | 22 ms | 42 ms | 75 ms | 0 |
| **Send gift (all to one host)** | **234** | **166 ms** | **561 ms** | **822 ms** | 0 |
| Live chat | 3,243 | 14 ms | 29 ms | 39 ms | spam limit only* |
| Mixed 70/20/10 | 1,979 | 23 ms | 49 ms | 64 ms | spam limit only* |

\* Each simulated user sends far faster than a person, so the anti-spam rule (5 messages per 10 s)
refuses most chat: that is the rule working, and each refusal is still a full database round trip.

Money check passed: 74,520 gifts; coins spent by viewers = coins in gifts; no negative wallets.

## Findings

- **One popular host is the bottleneck.** Every gift to a host updates the same two rows (that host's
  `creator_earnings` balance and the live `streams` coin total) inside the gift transaction, so
  simultaneous gifts to one host wait for each other: ~230 gifts/s and up to ~0.8 s per gift at 50
  concurrent gifters. Gifts spread across hosts don't contend (2,000/s). Fix (not done, money path —
  needs approval): record each gift as an insert only and roll host/stream totals up asynchronously
  (or spread them across several counter rows), keeping `earning_entries` as the ledger of record.
- Feed, random gifts and chat are comfortably fast at this size on 4 cores; the hosted project's
  compute size decides the real ceiling. Run against a staging project before launch events.
