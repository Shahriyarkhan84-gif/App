"""🤖 Moderation branch.

Two graphs:
- chat message: load -> rules -> (classify) -> act
- user report:  load -> assess -> act

The AI may hide content and issue warnings on its own. Anything heavier
(restrictions, bans) becomes an `ai_actions` proposal for an owner to approve.
"""

from __future__ import annotations

import re
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..db import Database
from ..llm import LLM, untrusted

Category = Literal["ok", "spam", "harassment", "hate", "sexual", "violence", "self_harm", "scam", "other"]

SYSTEM = (
    "You moderate live-stream chat for Zynalive, a South-Asia-first social live streaming platform "
    "(Urdu, Hindi, Bengali, Roman Urdu, English and more). Judge messages in context, including slang "
    "and code-mixed text. Friendly banter, criticism and mild profanity are allowed; targeted harassment, "
    "hate, sexual content involving minors, threats, scams (off-platform payment requests, fake giveaways) "
    "and spam are not. Severity: 0 none, 1 minor, 2 clear violation, 3 severe/illegal or threats."
)


class MessageVerdict(BaseModel):
    category: Category
    severity: int = Field(ge=0, le=3)
    confidence: float = Field(ge=0, le=1)
    explanation: str = Field(description="One sentence, shown to moderators")


class ReportAssessment(BaseModel):
    valid: bool = Field(description="Does the evidence support the report?")
    category: Category
    severity: int = Field(ge=0, le=3)
    confidence: float = Field(ge=0, le=1)
    summary: str = Field(description="2-3 sentences for the moderator reviewing this report")
    recommended_action: Literal["dismiss", "warning", "temp_restriction", "temp_ban", "permanent_ban", "account_review"]
    duration_hours: int | None = Field(default=None, description="For temp_restriction / temp_ban only")


class MessageState(TypedDict, total=False):
    message_id: int
    message: dict | None
    prior_actions: int
    flags: list[str]
    verdict: dict | None
    outcome: str


LINK_RE = re.compile(r"(https?://|www\.|\.com\b|wa\.me|t\.me)", re.I)
PHONE_RE = re.compile(r"(\+?\d[\d\s-]{8,}\d)")


def rule_flags(body: str) -> list[str]:
    flags = []
    if LINK_RE.search(body):
        flags.append("link")
    if PHONE_RE.search(body):
        flags.append("phone_number")
    letters = [c for c in body if c.isalpha()]
    if len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        flags.append("shouting")
    if re.search(r"(.)\1{7,}", body):
        flags.append("repeated_chars")
    return flags


def is_trivial(body: str) -> bool:
    """Very short or emoji/punctuation-only messages don't need a model call."""
    stripped = re.sub(r"[\W_]+", "", body, flags=re.UNICODE)
    return len(stripped) <= 2


def build_message_graph(db: Database, llm: LLM):
    def load(state: MessageState) -> MessageState:
        msg = db.one(
            """select m.id, m.body, m.sender_id, m.room_id, m.status, r.title as room_title
               from public.messages m join public.rooms r on r.id = m.room_id where m.id = %s""",
            (state["message_id"],),
        )
        prior = 0
        if msg:
            prior = db.one(
                """select count(*) as n from public.moderation_actions
                   where target_user_id = %s and created_at > now() - interval '30 days'""",
                (msg["sender_id"],),
            )["n"]
        return {"message": msg, "prior_actions": prior}

    def rules(state: MessageState) -> MessageState:
        return {"flags": rule_flags(state["message"]["body"])}

    def route(state: MessageState) -> str:
        msg = state.get("message")
        if not msg or msg["status"] != "visible":
            return "skip"
        if is_trivial(msg["body"]) and not state.get("flags"):
            return "skip"
        return "classify"

    def classify(state: MessageState) -> MessageState:
        msg = state["message"]
        recent = db.all(
            "select body from public.messages where room_id = %s and id < %s order by id desc limit 8",
            (msg["room_id"], msg["id"]),
        )
        context = "\n".join(f"- {r['body']}" for r in reversed(recent)) or "(none)"
        verdict = llm.structured(
            branch="moderation",
            system=SYSTEM,
            effort="low",
            schema=MessageVerdict,
            prompt=(
                f"Room: {msg['room_title']}\nRecent chat for context:\n{untrusted(context)}\n\n"
                f"Message to judge:\n{untrusted(msg['body'])}\n\n"
                f"Heuristic flags: {', '.join(state.get('flags') or []) or 'none'}. "
                f"Sender's moderation actions in the last 30 days: {state.get('prior_actions', 0)}."
            ),
        )
        return {"verdict": verdict.model_dump()}

    def act(state: MessageState) -> MessageState:
        msg, v = state["message"], state["verdict"]
        if v["category"] == "self_harm":
            # Never punish; route to humans for a welfare check.
            db.notify_admins("safety", "Possible self-harm in chat", v["explanation"], {"message_id": msg["id"]})
            return {"outcome": "escalated_welfare"}
        if v["severity"] >= 2 and v["confidence"] >= 0.7:
            db.run("select public.internal_hide_message(%s, %s)", (msg["id"], Jsonb({**v, "by": "ai"})))
            db.run("select public.internal_ai_moderation(%s, 'warning', %s, null)",
                   (msg["sender_id"], f"Chat message removed: {v['explanation']}"))
            if v["severity"] == 3 or state.get("prior_actions", 0) >= 2:
                action = "temp_ban" if v["severity"] == 3 else "temp_restriction"
                db.propose_action("moderation", action, msg["sender_id"],
                                  f"{v['category']} in chat (message {msg['id']}): {v['explanation']}",
                                  v["confidence"], {"hours": 24 if action == "temp_ban" else 6, "message_id": msg["id"]})
                return {"outcome": "hidden_warned_escalated"}
            return {"outcome": "hidden_warned"}
        if v["severity"] >= 1:
            db.run("update public.messages set moderation = %s where id = %s", (Jsonb({**v, "by": "ai"}), msg["id"]))
            return {"outcome": "noted"}
        return {"outcome": "ok"}

    g = StateGraph(MessageState)
    g.add_node("load", load)
    g.add_node("rules", rules)
    g.add_node("classify", classify)
    g.add_node("act", act)
    g.add_edge(START, "load")
    g.add_conditional_edges("load", lambda s: "rules" if s.get("message") else END)
    g.add_conditional_edges("rules", route, {"classify": "classify", "skip": END})
    g.add_edge("classify", "act")
    g.add_edge("act", END)
    return g.compile()


class ReportState(TypedDict, total=False):
    report_id: str
    report: dict | None
    evidence: str
    assessment: dict | None
    outcome: str


def build_report_graph(db: Database, llm: LLM):
    def load(state: ReportState) -> ReportState:
        report = db.one("select * from public.reports where id = %s and status = 'open'", (state["report_id"],))
        if not report:
            return {"report": None}
        parts = []
        if report["target_type"] == "message":
            m = db.one("select body, status from public.messages where id::text = %s", (report["target_id"],))
            if m:
                parts.append(f"Reported message ({m['status']}):\n{untrusted(m['body'])}")
        recent = db.all(
            "select body from public.messages where sender_id = %s order by created_at desc limit 20",
            (report["target_user_id"],),
        )
        if recent:
            parts.append("Target user's recent chat:\n" + untrusted("\n".join(f"- {r['body']}" for r in recent)))
        history = db.all(
            """select action, reason, created_at from public.moderation_actions
               where target_user_id = %s order by created_at desc limit 10""",
            (report["target_user_id"],),
        )
        parts.append("Prior moderation actions: " + (", ".join(f"{h['action']} ({h['created_at']:%Y-%m-%d})" for h in history) or "none"))
        others = db.one(
            "select count(*) as n from public.reports where target_user_id = %s and id <> %s and created_at > now() - interval '7 days'",
            (report["target_user_id"], report["id"]),
        )["n"]
        parts.append(f"Other reports against this user in the last 7 days: {others}")
        return {"report": report, "evidence": "\n\n".join(parts)}

    def assess(state: ReportState) -> ReportState:
        r = state["report"]
        a = llm.structured(
            branch="moderation",
            system=SYSTEM + " You are reviewing a user report. Follow the action ladder: warning -> temp restriction "
            "-> temp ban -> permanent ban; skip steps only for severe harm.",
            effort="medium",
            schema=ReportAssessment,
            prompt=f"Report type: {r['target_type']}\nReporter's reason:\n{untrusted(r['reason'])}\n\n{state['evidence']}",
        )
        return {"assessment": a.model_dump()}

    def act(state: ReportState) -> ReportState:
        r, a = state["report"], state["assessment"]
        db.run("update public.reports set ai_assessment = %s, status = 'reviewing' where id = %s", (Jsonb(a), r["id"]))
        action = a["recommended_action"]
        if not a["valid"] or action == "dismiss":
            return {"outcome": "recommend_dismiss"}
        if action == "warning" and a["confidence"] >= 0.8:
            db.run("select public.internal_ai_moderation(%s, 'warning', %s, %s)", (r["target_user_id"], a["summary"], r["id"]))
            return {"outcome": "warned"}
        db.propose_action("moderation", action, r["target_user_id"], a["summary"], a["confidence"],
                          {"hours": a.get("duration_hours") or 24, "report_id": str(r["id"])})
        return {"outcome": f"proposed_{action}"}

    g = StateGraph(ReportState)
    g.add_node("load", load)
    g.add_node("assess", assess)
    g.add_node("act", act)
    g.add_edge(START, "load")
    g.add_conditional_edges("load", lambda s: "assess" if s.get("report") else END)
    g.add_edge("assess", "act")
    g.add_edge("act", END)
    return g.compile()
