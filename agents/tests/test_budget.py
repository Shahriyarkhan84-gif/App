from datetime import datetime, timezone

from zynalive_agents.config import Settings
from zynalive_agents.db import MEDIA_KINDS
from zynalive_agents.worker import Worker


class NoLLM:
    def structured(self, **_):  # pragma: no cover - never called here
        raise AssertionError("no AI calls in this test")


def test_daily_ai_budget_stops_ai_jobs_but_not_media(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "unused")
    worker = Worker(Settings(daily_ai_jobs=2), db=object(), llm=NoLLM())
    day1 = datetime(2026, 10, 19, 12, tzinfo=timezone.utc)
    assert worker.claimable_kinds(day1) == worker.kinds
    worker.ai_started = 2
    limited = worker.claimable_kinds(day1)
    assert all(k in MEDIA_KINDS for k in limited) and len(limited) < len(worker.kinds)
    # A new UTC day resets the budget.
    assert worker.claimable_kinds(datetime(2026, 10, 20, 0, 1, tzinfo=timezone.utc)) == worker.kinds
    worker.pool.shutdown(wait=False)
