"""🤖 Support branch: drafts answers to support tickets, escalates the rest."""

from __future__ import annotations

from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from ..db import Database, to_json
from ..llm import LLM, untrusted

SYSTEM = (
    "You are Zynalive's support assistant. Answer in the user's language, warmly and briefly. "
    "Facts you can rely on: coins are bought in Wallet and credited automatically after payment; gifts are "
    "final; hosts receive 90% of gift coins as earnings; withdrawals are reviewed by staff; reports are "
    "reviewed by moderators. Never promise refunds, unbans, payouts or policy exceptions - escalate those. "
    "Escalate anything about safety, legal issues, account security, or payments you cannot explain from the context."
)


class SupportDraft(BaseModel):
    category: Literal["billing", "account", "technical", "safety", "creator", "other"]
    can_answer: bool = Field(description="True only if the reply fully resolves the ticket without staff action")
    reply: str = Field(description="Reply to send the user (or a holding message if escalating)")
    escalate_reason: str | None = None


class SupportState(TypedDict, total=False):
    ticket_id: str
    ticket: dict | None
    context: dict
    draft: dict
    outcome: str


def build_support_graph(db: Database, llm: LLM):
    def load(state: SupportState) -> SupportState:
        ticket = db.one("select * from public.support_tickets where id = %s and status = 'open'", (state["ticket_id"],))
        if not ticket:
            return {"ticket": None}
        uid = ticket["user_id"]
        context = {
            "wallet": db.one("select coin_balance, frozen from public.wallets where user_id = %s", (uid,)),
            "recent_payments": db.all(
                "select coins, amount_minor, currency, status, created_at from public.payments where user_id = %s order by created_at desc limit 5", (uid,)),
            "withdrawals": db.all(
                "select coins, status, created_at from public.withdrawals where host_id = %s order by created_at desc limit 5", (uid,)),
            "account_status": db.one("select public.user_status(%s) as status", (uid,)),
        }
        return {"ticket": ticket, "context": context}

    def draft(state: SupportState) -> SupportState:
        t = state["ticket"]
        d = llm.structured(
            branch="support",
            system=SYSTEM,
            effort="medium",
            schema=SupportDraft,
            prompt=f"Account context:\n{to_json(state['context'])}\n\nTicket:\n{untrusted(t['subject'] + chr(10) + t['body'])}",
        )
        return {"draft": d.model_dump()}

    def respond(state: SupportState) -> SupportState:
        t, d = state["ticket"], state["draft"]
        answered = d["can_answer"] and d["category"] != "safety"
        db.run(
            "update public.support_tickets set ai_reply = %s, category = %s, status = %s, updated_at = now() where id = %s",
            (d["reply"], d["category"], "answered" if answered else "escalated", t["id"]),
        )
        db.notify(t["user_id"], "support", f"Re: {t['subject']}", d["reply"], {"ticket_id": str(t["id"])})
        if not answered:
            db.notify_admins("support", f"Escalated ticket: {t['subject']}", d.get("escalate_reason"), {"ticket_id": str(t["id"])})
        return {"outcome": "answered" if answered else "escalated"}

    g = StateGraph(SupportState)
    g.add_node("load", load)
    g.add_node("draft", draft)
    g.add_node("respond", respond)
    g.add_edge(START, "load")
    g.add_conditional_edges("load", lambda s: "draft" if s.get("ticket") else END)
    g.add_edge("draft", "respond")
    g.add_edge("respond", END)
    return g.compile()
