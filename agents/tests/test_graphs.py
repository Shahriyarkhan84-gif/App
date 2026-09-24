from datetime import datetime, timezone

from zynalive_agents.config import Settings
from zynalive_agents.graphs.ceo import CeoBriefing, DomainReport, build_ceo_graph
from zynalive_agents.graphs.creator_assist import StreamCoaching, build_creator_graph
from zynalive_agents.graphs.fraud import FraudAssessment, build_fraud_graph
from zynalive_agents.graphs.moderation import (
    MessageVerdict, ReportAssessment, build_message_graph, build_report_graph, rule_flags,
)
from zynalive_agents.graphs.recommendations import build_recommendations_graph
from zynalive_agents.graphs.support import SupportDraft, build_support_graph
from zynalive_agents.graphs.translation import Translation, build_translation_graph
from zynalive_agents.worker import Worker

from .conftest import as_user


def send_chat(db, room, user, body):
    return as_user(db, user, "select (public.send_chat_message(%s, %s)).id", (room, body))[0]["id"]


# Moderation -------------------------------------------------------------------

def test_rule_flags():
    assert "link" in rule_flags("join wa.me/923001234567 for free coins")
    assert "phone_number" in rule_flags("call 0300 1234567 now")
    assert rule_flags("great stream!") == []


def test_trivial_messages_skip_the_model(db, llm, world):
    mid = send_chat(db, world["room"], "viewer1", "👍👍")
    out = build_message_graph(db, llm).invoke({"message_id": mid})
    assert "outcome" not in out and llm.calls == []


def test_violating_message_is_hidden_and_user_warned(db, llm, world):
    mid = send_chat(db, world["room"], "viewer1", "you are worthless, leave")
    llm.on(MessageVerdict, MessageVerdict(category="harassment", severity=2, confidence=0.92, explanation="Targeted insult"))
    out = build_message_graph(db, llm).invoke({"message_id": mid})
    assert out["outcome"] == "hidden_warned"
    assert db.one("select status from public.messages where id = %s", (mid,))["status"] == "hidden"
    assert db.one("select action, source from public.moderation_actions where target_user_id = 'viewer1'") == {"action": "warning", "source": "ai"}
    # Viewers no longer see it through RLS.
    assert as_user(db, "viewer2", "select count(*) as n from public.messages where id = %s", (mid,))[0]["n"] == 0


def test_severe_message_creates_ban_proposal_not_a_ban(db, llm, world):
    mid = send_chat(db, world["room"], "viewer1", "threatening message")
    llm.on(MessageVerdict, MessageVerdict(category="violence", severity=3, confidence=0.95, explanation="Threat"))
    build_message_graph(db, llm).invoke({"message_id": mid})
    proposal = db.one("select action_type, status from public.ai_actions where target_user_id = 'viewer1'")
    assert proposal == {"action_type": "temp_ban", "status": "proposed"}
    assert db.one("select public.user_status('viewer1') as s")["s"] == "active"


def test_self_harm_escalates_without_punishment(db, llm, world):
    mid = send_chat(db, world["room"], "viewer1", "i don't want to be here anymore")
    llm.on(MessageVerdict, MessageVerdict(category="self_harm", severity=2, confidence=0.8, explanation="Possible risk"))
    out = build_message_graph(db, llm).invoke({"message_id": mid})
    assert out["outcome"] == "escalated_welfare"
    assert db.one("select count(*) as n from public.moderation_actions")["n"] == 0
    assert db.one("select count(*) as n from public.notifications where user_id = 'owner' and type = 'safety'")["n"] == 1


def test_report_graph_proposes_ladder_action(db, llm, world):
    mid = send_chat(db, world["room"], "viewer1", "scam: send money to my jazzcash")
    report_id = as_user(db, "viewer2", "select (public.report_content('message', %s, 'Scamming people')).id", (str(mid),))[0]["id"]
    llm.on(ReportAssessment, ReportAssessment(valid=True, category="scam", severity=2, confidence=0.85,
                                              summary="Off-platform payment solicitation.", recommended_action="temp_restriction",
                                              duration_hours=12))
    out = build_report_graph(db, llm).invoke({"report_id": str(report_id)})
    assert out["outcome"] == "proposed_temp_restriction"
    assert db.one("select status from public.reports where id = %s", (report_id,))["status"] == "reviewing"
    assert db.one("select params->>'hours' as h from public.ai_actions")["h"] == "12"
    # The untrusted report text is fenced in the prompt.
    assert "<untrusted>" in llm.calls[0][2]


# Fraud ------------------------------------------------------------------------

def test_fraud_sweep_flags_circular_gifting(db, llm, world):
    as_user(db, "viewer1", "select public.become_host()")
    as_user(db, "viewer1", "select public.go_live('alt', 'chat')")
    room_v1 = db.one("select id from public.rooms where host_id = 'viewer1'")["id"]
    db.run("insert into public.wallets (user_id, coin_balance) values ('host1', 5000) on conflict (user_id) do update set coin_balance = 5000")
    # Galaxy (4999 coins) back and forth: viewer1 -> host1 and host1 -> viewer1.
    galaxy = db.one("select id from public.gift_catalog where name = 'Galaxy'")["id"]
    as_user(db, "viewer1", "select public.send_gift(%s, %s, 1, 'fraud-key-01')", (world["room"], galaxy))
    as_user(db, "host1", "select public.send_gift(%s, %s, 1, 'fraud-key-02')", (room_v1, galaxy))

    llm.on(FraudAssessment, lambda prompt: FraudAssessment(
        risk="high", confidence=0.8, rationale="Circular gifting between two accounts", recommended_action="freeze_wallet"))
    out = build_fraud_graph(db, llm).invoke({"user_ids": None})
    assert out["proposals"] == 2
    assert {r["target_user_id"] for r in db.all("select target_user_id from public.ai_actions where action_type = 'freeze_wallet'")} == {"viewer1", "host1"}
    # Re-running does not duplicate open proposals.
    assert build_fraud_graph(db, llm).invoke({"user_ids": None})["proposals"] == 0


def test_fraud_sweep_without_signals_makes_no_model_calls(db, llm, world):
    out = build_fraud_graph(db, llm).invoke({"user_ids": None})
    assert out["suspects"] == [] and llm.calls == []


# Support, creator assist, translation --------------------------------------------

def test_support_answers_or_escalates(db, llm, world):
    t1 = as_user(db, "viewer1", "select (public.create_support_ticket('How do gifts work?', 'What does the host get?')).id")[0]["id"]
    t2 = as_user(db, "viewer1", "select (public.create_support_ticket('Refund please', 'I want my money back now')).id")[0]["id"]
    llm.on(SupportDraft, lambda prompt: SupportDraft(category="billing", can_answer=False, reply="We've passed this to our team.",
                                                     escalate_reason="Refund request")
           if "Refund" in prompt else SupportDraft(category="creator", can_answer=True, reply="Hosts receive 90% of gift coins."))
    graph = build_support_graph(db, llm)
    assert graph.invoke({"ticket_id": str(t1)})["outcome"] == "answered"
    assert graph.invoke({"ticket_id": str(t2)})["outcome"] == "escalated"
    assert db.one("select status from public.support_tickets where id = %s", (t2,))["status"] == "escalated"


def test_creator_assist_after_stream_end(db, llm, world):
    send_chat(db, world["room"], "viewer1", "great stream")
    as_user(db, "host1", "select public.end_live()")
    job = db.one("select payload from public.ai_jobs where kind = 'creator_assist'")
    llm.on(StreamCoaching, StreamCoaching(headline="Nice first stream!", summary="Short and friendly.", tips=["a", "b", "c"]))
    build_creator_graph(db, llm).invoke({"stream_id": job["payload"]["stream_id"]})
    assert db.one("select ai_summary->>'headline' as h from public.streams")["h"] == "Nice first stream!"
    assert db.one("select count(*) as n from public.notifications where user_id = 'host1' and type = 'creator_assist'")["n"] == 1


def test_translation_is_cached(db, llm, world):
    mid = send_chat(db, world["room"], "viewer1", "bohat acha stream hai")
    llm.on(Translation, Translation(text="Very good stream"))
    graph = build_translation_graph(db, llm)
    assert graph.invoke({"message_id": mid, "language": "en"})["text"] == "Very good stream"
    graph.invoke({"message_id": mid, "language": "en"})
    assert len(llm.calls) == 1


# Recommendations --------------------------------------------------------------------

def test_recommendations_rank_followed_hosts(db, llm, world):
    as_user(db, "viewer1", "insert into public.follows (followee_id) values ('host1')")
    send_chat(db, world["room"], "viewer1", "hello")  # makes viewer1 "active"
    build_recommendations_graph(db).invoke({})
    rec = db.one("select room_id, reason from public.user_recommendations where user_id = 'viewer1'")
    assert rec["room_id"] == world["room"] and "you follow this host" in rec["reason"]
    assert as_user(db, "viewer2", "select count(*) as n from public.user_recommendations where user_id = 'viewer1'")[0]["n"] == 0


# AI CEO ------------------------------------------------------------------------------

def test_ceo_runs_three_domain_agents_then_synthesizes(db, llm, world):
    report = DomainReport(status="green", headline="ok", highlights=["x"], risks=[], recommendations=["y"])
    llm.on(DomainReport, report)
    llm.on(CeoBriefing, CeoBriefing(headline="Steady day", summary="All good.", priorities=["a", "b", "c"], owner_decisions=["Set coin->PKR rate"]))
    out = build_ceo_graph(db, llm).invoke({})
    assert set(out["domain_reports"]) == {"finance_ai", "economy_ai", "streaming_ai"}
    assert [c[1] for c in llm.calls].count(DomainReport) == 3 and llm.calls[-1][1] is CeoBriefing
    saved = db.one("select headline, data from public.ai_reports where id = %s", (out["report_id"],))
    assert saved["headline"] == "Steady day" and saved["data"]["kpis"]["streaming"]["live_now"] == 1
    assert db.one("select count(*) as n from public.notifications where user_id = 'owner' and type = 'ceo_briefing'")["n"] == 1
    # Only admins can read AI reports.
    assert as_user(db, "viewer1", "select count(*) as n from public.ai_reports")[0]["n"] == 0
    assert as_user(db, "owner", "select count(*) as n from public.ai_reports")[0]["n"] == 1


# Worker ----------------------------------------------------------------------------------

def make_worker(db, llm, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "unused")
    return Worker(Settings(), db, llm)


def test_worker_processes_queue_and_executes_approved_actions(db, llm, world, monkeypatch):
    llm.on(MessageVerdict, MessageVerdict(category="violence", severity=3, confidence=0.9, explanation="Threat"))
    mid = send_chat(db, world["room"], "viewer1", "a threat")
    worker = make_worker(db, llm, monkeypatch)
    assert worker.drain_once() == 1
    worker.pool.shutdown(wait=True)
    assert db.one("select status from public.ai_jobs where payload->>'message_id' = %s", (str(mid),))["status"] == "done"

    action = db.one("select id from public.ai_actions where target_user_id = 'viewer1'")["id"]
    worker.execute_approved_actions()  # not approved yet -> nothing happens
    assert db.one("select public.user_status('viewer1') as s")["s"] == "active"
    as_user(db, "owner", "select public.review_ai_action(%s, true)", (action,))
    worker.execute_approved_actions()
    assert db.one("select public.user_status('viewer1') as s")["s"] == "banned"


def test_worker_retries_with_backoff(db, llm, world, monkeypatch):
    send_chat(db, world["room"], "viewer1", "some message to classify")  # FakeLLM has no responder -> error
    worker = make_worker(db, llm, monkeypatch)
    worker.drain_once()
    worker.pool.shutdown(wait=True)
    job = db.one("select status, attempts, error, run_after > now() as delayed from public.ai_jobs")
    assert job["status"] == "queued" and job["attempts"] == 1 and job["delayed"] and "unexpected LLM call" in job["error"]


def test_schedule_is_idempotent_per_bucket(db, llm, monkeypatch):
    worker = make_worker(db, llm, monkeypatch)
    now = datetime(2026, 9, 24, 10, 5, tzinfo=timezone.utc)
    worker.schedule(now)
    worker.schedule(now)
    kinds = sorted(r["kind"] for r in db.all("select kind from public.ai_jobs"))
    assert kinds == ["ceo_briefing", "fraud_sweep", "recommendations"]
