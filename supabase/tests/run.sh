#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies the stub + migrations, runs the tests.
# Usage: supabase/tests/run.sh   (needs postgres binaries: initdb, pg_ctl, psql)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
PORT="${PGPORT_TEST:-54329}"
DATA="$(mktemp -d)"
trap 'pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT

if [ "$(id -u)" = "0" ]; then
  echo "Run as a non-root user (postgres refuses to run as root)." >&2
  exit 1
fi

initdb -D "$DATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" start >/dev/null
export PGHOST="$DATA" PGPORT="$PORT" PGUSER=postgres
createdb zynalive_test
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d zynalive_test)

"${PSQL[@]}" -f "$HERE/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f" >/dev/null
done
echo "✓ migrations applied"

for f in "$HERE"/[1-9]*.sql; do
  "${PSQL[@]}" -f "$f" >/dev/null
  echo "✓ $(basename "$f")"
done

# Concurrency: 8 parallel identical gift requests must charge exactly once.
"${PSQL[@]}" -f "$HERE/fixtures/concurrency_setup.sql"
for i in $(seq 1 8); do
  "${PSQL[@]}" -c "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"c_viewer\"}', false); select public.send_gift((select id from public.rooms where host_id='c_host'), 1, 10, 'concurrent-key-1');" >/dev/null &
done
wait
"${PSQL[@]}" -f "$HERE/fixtures/concurrency_check.sql"
echo "✓ concurrent duplicate gifts charged once"

if [ "${KEEP_DB:-}" = "1" ]; then
  echo "DATABASE_URL=postgresql://postgres@/zynalive_test?host=$DATA&port=$PORT"
  trap - EXIT
fi
echo "All database tests passed."
