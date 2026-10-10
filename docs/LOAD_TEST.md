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

## After the hot-row fix — 2026-10-10

Same machine and settings, with `20261010010000_gift_hot_rows.sql`:

| Scenario | Requests/s | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|
| Home feed (200 live rooms) | 1,897 | 24 ms | 52 ms | 67 ms | 0 |
| Send gift (random host) | 1,732 | 26 ms | 52 ms | 85 ms | 0 |
| **Send gift (all to one host)** | **1,672** | **26 ms** | **54 ms** | **134 ms** | 0 |
| Live chat | 2,914 | 16 ms | 32 ms | 43 ms | spam limit only* |
| Mixed 70/20/10 | 1,703 | 26 ms | 58 ms | 78 ms | spam limit only* |

Gifts to one host went from 234/s to 1,672/s (p95 561 ms → 54 ms). Gifts spread across hosts cost
a little more per gift (one extra insert and delete), 2,046/s → 1,732/s. Money check passed after
107,301 gifts: viewers' spent coins = coins in gifts, host earnings = host shares, stream totals =
coins gifted, no negative wallets.

## Indexes — 2026-10-10

`20261010020000_indexes.sql` adds 21 indexes. `EXPLAIN=1 supabase/tests/load/run.sh` prints the check:
the AI coach's per-stream chat count over 72,813 messages took 5.9 ms with a full scan and 0.06 ms
with `messages_stream_idx` (it grows with the table). Load test afterwards: feed 1,978/s, gifts
1,798/s (one host 1,787/s), chat 3,020/s — no slower than before the indexes.

## Caching — 2026-10-10

Rankings (weekly top gifters, ~117k gifts in the week): computed from the gifts every time, 22
requests/s with a 2 s median; through the 60 s shared cache (`20261010030000_rankings_cache.sql`),
13,244 requests/s at 2.7 ms (p99 9 ms). Other scenarios unchanged.

## Full-size run — 2026-10-10 (step 3)

20,000 viewers, 500 live hosts, a live PK battle (h1 vs h2), 50 concurrent users, 20 s each, then
the realistic mix (55% feed, 15% chat, 12% join/leave, 8% gifts, 4% DMs, 3% follows, 2% rankings,
1% PK gifts) stepped up from 25 to 400 concurrent users. Same 4-core container.

```bash
su postgres -s /bin/bash -c "cd /tmp && USERS=20000 HOSTS=500 CLIENTS=50 DURATION=20 RAMP='25 50 100 200 400' bash supabase/tests/load/run.sh"
```

| Scenario | Requests/s | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Home feed | 1,474 | 31 ms | 65 ms | 85 ms |
| Gift, random host | 1,817 | 25 ms | 51 ms | 70 ms |
| Gift, one host | 1,856 | 24 ms | 49 ms | 67 ms |
| Gifts during a live PK battle | 1,769 | 26 ms | 53 ms | 71 ms |
| Live chat | 2,625 | 18 ms | 33 ms | 44 ms |
| Rankings (cached) | 12,577 | 3 ms | 7 ms | 10 ms |
| Join/leave, random rooms | 5,706 | 8 ms | 15 ms | 21 ms |
| **Join/leave, one viral live** | **7,185** (was 459) | **6 ms** (was 71) | **13 ms** (was 340) | **17 ms** (was 546) |
| Direct messages | 4,133 | 11 ms | 21 ms | 27 ms |
| Follow / unfollow | 7,365 | 6 ms | 14 ms | 20 ms |
| Realistic mix | 1,681 | 27 ms | 59 ms | 82 ms |

Step-up (realistic mix):

| Concurrent users | Requests/s | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|
| 25 | 1,649 | 14 ms | 31 ms | 42 ms |
| 50 | 1,792 | 25 ms | 54 ms | 73 ms |
| 100 | 1,634 | 53 ms | 125 ms | 169 ms |
| 200 | 1,408 | 118 ms | 292 ms | 457 ms |
| 400 | 1,205 | 281 ms | 622 ms | 1,090 ms |

- **Capacity:** this 4-core database peaks at ~1,800 requests/s with ~25–50 requests in flight; past
  that, requests queue (latency doubles with each doubling) and throughput slowly falls. Clients
  must reach Postgres through pooling (PostgREST/Supavisor do this) so in-flight queries stay near
  the core count. Real users pause between actions: at one request every ~5 s per active user,
  1,800/s is roughly 9,000 people actively using the app at once on this size of machine; the
  hosted compute size sets the real figure.
- **Viral lives fixed** (`20261010040000_viewer_event_hot_rows.sql`): every LiveKit join/leave rewrote
  the room's viewer count and the stream's peak. The count is now written only when it changes and
  skipped while another event holds the row (LiveKit sends the full count every time); the peak only
  when it rises.
- Money checks after 125k+ gifts: viewers' coins = gifts, host earnings = host shares, stream totals
  = coins gifted, PK score = gifts per side (59,351 : 22,902), no negative wallets.
- Not covered here: network from Pakistan, PostgREST/Realtime fan-out (every viewer-count change is
  broadcast to subscribed clients), LiveKit video. Next: run against a staging Supabase project.

## Findings (before the fix)

- **One popular host is the bottleneck.** Every gift to a host updates the same two rows (that host's
  `creator_earnings` balance and the live `streams` coin total) inside the gift transaction, so
  simultaneous gifts to one host wait for each other: ~230 gifts/s and up to ~0.8 s per gift at 50
  concurrent gifters. Gifts spread across hosts don't contend (2,000/s). Fixed in
  `20261010010000_gift_hot_rows.sql` (tallies folded with `SKIP LOCKED`; see `docs/ECONOMY.md`).
- Feed, random gifts and chat are comfortably fast at this size on 4 cores; the hosted project's
  compute size decides the real ceiling. Run against a staging project before launch events.
