"""Agent tests run against a real Postgres with the Supabase migrations applied
and a deterministic fake LLM (no network, no cost).

Set TEST_DATABASE_URL to a server where the test may create/drop the
`zynalive_agents_test` database (see agents/README.md). Skipped otherwise.
"""

from __future__ import annotations

import os
import pathlib
from typing import Callable

import psycopg
import pytest
from pydantic import BaseModel

from zynalive_agents.db import Database

ROOT = pathlib.Path(__file__).resolve().parents[2]
TEST_DB = "zynalive_agents_test"


@pytest.fixture(scope="session")
def database_url() -> str:
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("TEST_DATABASE_URL not set")
    with psycopg.connect(admin_url, autocommit=True) as c:
        c.execute(f"drop database if exists {TEST_DB} with (force)")
        c.execute(f"create database {TEST_DB}")
    url = psycopg.conninfo.make_conninfo(admin_url, dbname=TEST_DB)
    with psycopg.connect(url, autocommit=True) as c:
        c.execute((ROOT / "supabase/tests/00_supabase_stub.sql").read_text())
        for f in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            c.execute(f.read_text())
    return url


@pytest.fixture()
def db(database_url):
    database = Database(database_url, max_size=4)
    # Fresh data per test (keep seed catalog/settings tables).
    database.run("""
      truncate public.profiles, public.agencies, public.ai_jobs, public.ai_reports, public.ai_actions,
               public.processed_webhook_events, public.audit_logs restart identity cascade
    """)
    database.run("update public.platform_settings set value = '{\"mode\": \"all\"}' where key = 'ai_moderation'")
    yield database
    database.close()


class FakeLLM:
    """Returns canned structured outputs per schema and records every call."""

    def __init__(self):
        self.responders: dict[type, Callable[[str], BaseModel]] = {}
        self.calls: list[tuple[str, type, str]] = []

    def on(self, schema: type, responder: Callable[[str], BaseModel] | BaseModel):
        self.responders[schema] = responder if callable(responder) else (lambda _p, r=responder: r)
        return self

    def structured(self, *, branch, system, prompt, schema, effort="medium"):
        self.calls.append((branch, schema, prompt))
        if schema not in self.responders:
            raise AssertionError(f"unexpected LLM call for {schema.__name__}")
        return self.responders[schema](prompt)


@pytest.fixture()
def llm():
    return FakeLLM()


def as_user(db: Database, user_id: str, sql: str, params=None):
    """Runs SQL as an authenticated app user (RLS + grants apply)."""
    with db.conn() as c, c.transaction():
        c.execute("select set_config('request.jwt.claims', %s, true)", (f'{{"sub":"{user_id}"}}',))
        c.execute("set local role authenticated")
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else None


@pytest.fixture()
def world(db):
    """Two viewers, a live host, an owner."""
    db.run("""
      insert into public.profiles (id, username, display_name, country, language, role) values
        ('viewer1', 'viewer1', 'Viewer One', 'PK', 'ur', 'USER'),
        ('viewer2', 'viewer2', 'Viewer Two', 'IN', 'hi', 'USER'),
        ('host1', 'host1', 'Host One', 'PK', 'ur', 'USER'),
        ('owner', 'owner', 'Owner', 'PK', 'en', 'OWNER_ADMIN');
      insert into public.wallets (user_id, coin_balance) values ('viewer1', 5000), ('viewer2', 5000);
    """)
    as_user(db, "host1", "select public.become_host()")
    as_user(db, "host1", "select public.go_live('Chai & chat', 'chat')")
    room = db.one("select id from public.rooms where host_id = 'host1'")["id"]
    return {"room": room}
