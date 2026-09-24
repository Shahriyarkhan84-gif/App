"""Postgres access (service connection; bypasses RLS) and the ai_jobs queue."""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


class Database:
    def __init__(self, url: str, max_size: int = 8):
        self.pool = ConnectionPool(url, min_size=1, max_size=max_size, kwargs={"row_factory": dict_row, "autocommit": True}, open=True)

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def conn(self) -> Iterator[Connection]:
        with self.pool.connection() as c:
            yield c

    def all(self, sql: str, params: Any = None) -> list[dict]:
        with self.conn() as c:
            return c.execute(sql, params).fetchall()

    def one(self, sql: str, params: Any = None) -> dict | None:
        with self.conn() as c:
            return c.execute(sql, params).fetchone()

    def run(self, sql: str, params: Any = None) -> None:
        with self.conn() as c:
            c.execute(sql, params)

    # Queue -----------------------------------------------------------------

    def enqueue(self, kind: str, payload: dict, dedupe_key: str | None = None) -> None:
        self.run(
            "insert into public.ai_jobs (kind, payload, dedupe_key) values (%s, %s, %s) on conflict (dedupe_key) do nothing",
            (kind, Jsonb(payload), dedupe_key),
        )

    def claim_job(self) -> dict | None:
        """Atomically claims the oldest ready job (SKIP LOCKED lets many workers share the queue)."""
        return self.one(
            """
            update public.ai_jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
            where id = (
              select id from public.ai_jobs
              where status = 'queued' and run_after <= now()
              order by id for update skip locked limit 1
            )
            returning *
            """
        )

    def complete_job(self, job_id: int, result: dict | None) -> None:
        self.run(
            "update public.ai_jobs set status = 'done', result = %s, error = null, updated_at = now() where id = %s",
            (Jsonb(result or {}), job_id),
        )

    def fail_job(self, job_id: int, error: str, attempts: int, max_attempts: int) -> None:
        if attempts >= max_attempts:
            self.run("update public.ai_jobs set status = 'failed', error = %s, updated_at = now() where id = %s", (error[:2000], job_id))
        else:
            # Exponential backoff: 1, 2, 4, 8... minutes.
            self.run(
                """update public.ai_jobs set status = 'queued', error = %s, updated_at = now(),
                   run_after = now() + make_interval(mins => %s) where id = %s""",
                (error[:2000], 2 ** (attempts - 1), job_id),
            )

    def requeue_stale(self, older_than_min: int = 15) -> int:
        """Jobs left 'running' by a crashed worker go back to the queue."""
        rows = self.all(
            """update public.ai_jobs set status = 'queued', updated_at = now()
               where status = 'running' and locked_at < now() - make_interval(mins => %s) returning id""",
            (older_than_min,),
        )
        return len(rows)

    # Shared helpers used by several graphs -----------------------------------

    def propose_action(self, agent: str, action_type: str, user_id: str | None, rationale: str,
                       confidence: float, params: dict | None = None) -> bool:
        """Creates an owner-review proposal unless an equivalent one is already open."""
        row = self.one(
            """
            insert into public.ai_actions (agent, action_type, target_user_id, rationale, confidence, params)
            select %s, %s, %s, %s, %s, %s
            where not exists (
              select 1 from public.ai_actions
              where target_user_id is not distinct from %s and action_type = %s
                and status in ('proposed', 'approved') and created_at > now() - interval '24 hours'
            )
            returning id
            """,
            (agent, action_type, user_id, rationale[:2000], confidence, Jsonb(params or {}), user_id, action_type),
        )
        return row is not None

    def notify(self, user_id: str, type_: str, title: str, body: str | None, data: dict | None = None) -> None:
        self.run(
            "insert into public.notifications (user_id, type, title, body, data) values (%s, %s, %s, %s, %s)",
            (user_id, type_, title[:200], body, Jsonb(data or {})),
        )

    def notify_admins(self, type_: str, title: str, body: str | None, data: dict | None = None) -> None:
        self.run(
            """insert into public.notifications (user_id, type, title, body, data)
               select id, %s, %s, %s, %s from public.profiles where role in ('OWNER_ADMIN', 'SUPER_ADMIN')""",
            (type_, title[:200], body, Jsonb(data or {})),
        )


def to_json(value: Any) -> str:
    return json.dumps(value, default=str)
