"""Background worker: runs the LangGraph agents continuously.

- Consumes `ai_jobs` (enqueued by Postgres RPCs: chat messages, reports,
  tickets, stream ends, translation requests) with SKIP LOCKED, so any number
  of worker replicas can share the queue.
- Schedules periodic jobs: AI CEO briefing, fraud sweep, recommendations.
- Executes AI proposals once an owner has approved them.

Run: `python -m zynalive_agents.worker` (see Dockerfile).
"""

from __future__ import annotations

import logging
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable

from .config import Settings
from .db import Database
from .graphs.ceo import build_ceo_graph
from .graphs.creator_assist import build_creator_graph
from .graphs.fraud import build_fraud_graph
from .graphs.moderation import build_message_graph, build_report_graph
from .graphs.recommendations import build_recommendations_graph
from .graphs.support import build_support_graph
from .graphs.translation import build_translation_graph
from .llm import LLM, ClaudeLLM, LLMRefusal

log = logging.getLogger("zynalive.worker")


def build_dispatch(db: Database, llm: LLM) -> dict[str, Callable[[dict], dict]]:
    """Maps ai_jobs.kind -> a function running the matching graph on the job payload."""
    message = build_message_graph(db, llm)
    report = build_report_graph(db, llm)
    fraud = build_fraud_graph(db, llm)
    support = build_support_graph(db, llm)
    creator = build_creator_graph(db, llm)
    translation = build_translation_graph(db, llm)
    recs = build_recommendations_graph(db)
    ceo = build_ceo_graph(db, llm)

    def pick(*keys):
        return lambda state: {k: state.get(k) for k in keys}

    return {
        "moderate_message": lambda p: pick("outcome", "verdict")(message.invoke({"message_id": int(p["message_id"])})),
        "moderate_report": lambda p: pick("outcome", "assessment")(report.invoke({"report_id": p["report_id"]})),
        "fraud_sweep": lambda p: pick("proposals")(fraud.invoke({"user_ids": None})),
        "fraud_review": lambda p: pick("proposals")(fraud.invoke({"user_ids": p.get("user_ids")})),
        "support_ticket": lambda p: pick("outcome")(support.invoke({"ticket_id": p["ticket_id"]})),
        "creator_assist": lambda p: pick("coaching")(creator.invoke({"stream_id": p["stream_id"]})),
        "translate_message": lambda p: pick("text")(translation.invoke({"message_id": int(p["message_id"]), "language": p["language"]})),
        "recommendations": lambda p: pick("written")(recs.invoke({})),
        "ceo_briefing": lambda p: pick("report_id", "briefing")(ceo.invoke({})),
    }


class Worker:
    def __init__(self, settings: Settings, db: Database, llm: LLM):
        self.settings = settings
        self.db = db
        self.dispatch = build_dispatch(db, llm)
        self.stop = threading.Event()
        self.slots = threading.Semaphore(settings.concurrency)
        self.pool = ThreadPoolExecutor(max_workers=settings.concurrency, thread_name_prefix="agent")

    # Jobs ---------------------------------------------------------------------

    def process(self, job: dict) -> None:
        started = time.monotonic()
        try:
            handler = self.dispatch.get(job["kind"])
            if handler is None:
                raise ValueError(f"no handler for {job['kind']}")
            result = handler(job["payload"])
            self.db.complete_job(job["id"], result)
            log.info("job %s %s done in %.1fs", job["id"], job["kind"], time.monotonic() - started)
        except LLMRefusal as exc:
            # Not retryable; leave it for humans.
            self.db.fail_job(job["id"], f"refusal: {exc}", self.settings.max_attempts, self.settings.max_attempts)
            log.warning("job %s %s refused", job["id"], job["kind"])
        except Exception as exc:  # noqa: BLE001 - one bad job must not kill the worker
            self.db.fail_job(job["id"], f"{type(exc).__name__}: {exc}", job["attempts"], self.settings.max_attempts)
            log.exception("job %s %s failed (attempt %s)", job["id"], job["kind"], job["attempts"])
        finally:
            self.slots.release()

    def drain_once(self) -> int:
        """Claims and starts as many jobs as there are free slots. Returns how many started."""
        started = 0
        while not self.stop.is_set() and self.slots.acquire(blocking=False):
            job = self.db.claim_job()
            if job is None:
                self.slots.release()
                break
            self.pool.submit(self.process, job)
            started += 1
        return started

    # Schedules & approvals ------------------------------------------------------

    def schedule(self, now: datetime | None = None) -> None:
        """Enqueues periodic jobs; the dedupe key per time bucket makes this safe across replicas."""
        now = now or datetime.now(timezone.utc)
        minute_of_day = now.hour * 60 + now.minute
        for kind, every in (
            ("ceo_briefing", self.settings.ceo_every_min),
            ("fraud_sweep", self.settings.fraud_every_min),
            ("recommendations", self.settings.recs_every_min),
        ):
            bucket = minute_of_day // max(every, 1)
            self.db.enqueue(kind, {}, f"{kind}:{now:%Y%m%d}:{bucket}")

    def execute_approved_actions(self) -> None:
        for row in self.db.all("select id from public.ai_actions where status = 'approved' order by id limit 20"):
            try:
                self.db.run("select public.internal_execute_ai_action(%s)", (row["id"],))
                log.info("executed approved ai_action %s", row["id"])
            except Exception:  # noqa: BLE001
                log.exception("ai_action %s failed", row["id"])
                self.db.run("update public.ai_actions set status = 'failed', updated_at = now() where id = %s", (row["id"],))

    # Main loop ------------------------------------------------------------------

    def run(self) -> None:
        log.info("worker started (concurrency=%s)", self.settings.concurrency)
        last_housekeeping = 0.0
        while not self.stop.is_set():
            try:
                if time.monotonic() - last_housekeeping > 30:
                    requeued = self.db.requeue_stale()
                    if requeued:
                        log.warning("requeued %s stale jobs", requeued)
                    self.schedule()
                    self.execute_approved_actions()
                    last_housekeeping = time.monotonic()
                if self.drain_once() == 0:
                    self.stop.wait(self.settings.poll_interval_s)
            except Exception:  # noqa: BLE001 - e.g. DB restarts; back off and continue
                log.exception("worker loop error")
                self.stop.wait(5)
        log.info("shutting down; waiting for running jobs")
        self.pool.shutdown(wait=True)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings()
    db = Database(settings.database_url, max_size=settings.concurrency + 2)
    worker = Worker(settings, db, ClaudeLLM(settings.model_for))
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: worker.stop.set())
    try:
        worker.run()
    finally:
        db.close()


if __name__ == "__main__":
    main()
