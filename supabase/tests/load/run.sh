#!/usr/bin/env bash
# Database load test: a throwaway Postgres with the real migrations, seeded with USERS viewers and
# HOSTS live hosts, then pgbench drives CLIENTS concurrent users through each scenario for DURATION seconds.
# Measures what the database can do; it does not include network latency, PostgREST or LiveKit.
# Usage (non-root): supabase/tests/load/run.sh      Tune: USERS=20000 HOSTS=500 CLIENTS=100 DURATION=60
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
USERS="${USERS:-5000}" HOSTS="${HOSTS:-300}" CLIENTS="${CLIENTS:-50}" SECONDS_EACH="${DURATION:-30}"
PORT="${PGPORT_LOAD:-54330}"
DATA="$(mktemp -d)"
OUT="$(mktemp -d)"
trap 'pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA" "$OUT"' EXIT

if [ "$(id -u)" = "0" ]; then echo "Run as a non-root user (postgres refuses to run as root)." >&2; exit 1; fi

initdb -D "$DATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses='' -c max_connections=$((CLIENTS + 20)) -c shared_buffers=256MB" -l "$DATA/log" start >/dev/null
export PGHOST="$DATA" PGPORT="$PORT" PGUSER=postgres
createdb zynalive_load
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d zynalive_load)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
"${PSQL[@]}" -v users="$USERS" -v hosts="$HOSTS" -f "$HERE/seed.sql" >/dev/null
echo "Seeded $USERS viewers, $HOSTS live hosts. $CLIENTS concurrent users, ${SECONDS_EACH}s per scenario."
echo
printf '%-34s %8s %9s %9s %9s %8s\n' "scenario" "req/s" "p50 ms" "p95 ms" "p99 ms" "errors"

run() { # name, script(s)...
  local name="$1"; shift
  local args=() s
  for s in "$@"; do args+=(-f "$HERE/$s"); done
  "${PSQL[@]}" -c "truncate loadtest.errors" >/dev/null
  rm -f "$OUT"/log*
  local res
  res="$(cd "$OUT" && pgbench -n -c "$CLIENTS" -j 4 -T "$SECONDS_EACH" -D users="$USERS" -D hosts="$HOSTS" -l --log-prefix=log "${args[@]}" zynalive_load 2>&1)" || { echo "$res" >&2; exit 1; }
  local tps errs
  tps="$(echo "$res" | sed -n 's/^tps = \([0-9.]*\).*/\1/p' | head -1)"
  errs="$("${PSQL[@]}" -tAc "select count(*) from loadtest.errors")"
  # Column 3 of pgbench's per-transaction log is latency in microseconds.
  read -r p50 p95 p99 < <(cat "$OUT"/log* | awk '{print $3}' | sort -n | awk '{a[NR]=$1} END {printf "%.1f %.1f %.1f\n", a[int(NR*0.50)]/1000, a[int(NR*0.95)]/1000, a[int(NR*0.99)]/1000}')
  printf '%-34s %8.0f %9s %9s %9s %8s\n' "$name" "$tps" "$p50" "$p95" "$p99" "$errs"
  "${PSQL[@]}" -tAc "select '    ' || error || ' × ' || count(*) from loadtest.errors group by error order by count(*) desc limit 3"
}

run "Home feed (200 live rooms)" feed.sql
run "Send gift (random host)" gift.sql
run "Send gift (all to one host)" hotgift.sql
run "Live chat" chat.sql
run "Mixed (70% feed/20% chat/10% gift)" feed.sql@70 chat.sql@20 gift.sql@10

echo
"${PSQL[@]}" -f "$HERE/check.sql"
[ "${EXPLAIN:-}" = "1" ] && psql -X -d zynalive_load -f "$HERE/explain.sql"
echo "Load test finished; money checks passed."
