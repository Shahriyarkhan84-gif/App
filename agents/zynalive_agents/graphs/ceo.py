"""🧠 AI CEO / platform brain.

Supervisor graph that mirrors the architecture:

    collect_kpis ──┬──> finance_ai   (Agency · User · Fraud)   ──┐
                   ├──> economy_ai   (Host · Gift · Wallet)    ──┼──> ceo_synthesize ──> publish
                   └──> streaming_ai (LiveKit · Cost · Quality) ─┘

The three domain agents run in parallel (LangGraph fan-out/fan-in). The CEO
writes a briefing to `ai_reports` for the Owner command center and notifies
owners. Recommendations that need a decision are listed for humans; the CEO
does not act on its own.
"""

from __future__ import annotations

import operator
from typing import Annotated, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..db import Database, to_json
from ..llm import LLM

# Rough LiveKit Cloud cost model for the Streaming AI (override per contract).
LIVEKIT_USD_PER_PARTICIPANT_MIN = 0.0005

KPI_QUERIES: dict[str, str] = {
    "users": """
      select (select count(*) from public.profiles) as total,
             (select count(*) from public.profiles where created_at > now() - interval '24 hours') as new_24h,
             (select count(distinct u) from (
                select sender_id u from public.messages where created_at > now() - interval '24 hours'
                union select user_id from public.viewers where joined_at > now() - interval '24 hours'
                union select sender_id from public.gifts where created_at > now() - interval '24 hours') d) as dau,
             (select count(distinct u) from (
                select sender_id u from public.messages where created_at > now() - interval '30 days'
                union select user_id from public.viewers where joined_at > now() - interval '30 days') d) as mau,
             (select round(100.0 * count(*) filter (where exists (
                   select 1 from public.viewers v where v.user_id = p.id and v.joined_at > now() - interval '7 days'))
                 / nullif(count(*), 0), 1)
              from public.profiles p where p.created_at between now() - interval '14 days' and now() - interval '7 days') as d7_retention_pct
    """,
    "revenue": """
      select currency, count(*) as purchases, sum(amount_minor) as amount_minor, count(distinct user_id) as payers
      from public.payments where status = 'paid' and paid_at > now() - interval '24 hours' group by currency
    """,
    "payment_risk": """
      select count(*) filter (where status = 'refunded') as refunded_30d,
             count(*) filter (where status = 'disputed') as open_disputes,
             count(*) filter (where status = 'dispute_lost') as lost_disputes_30d,
             (select count(*) from public.refund_requests where status = 'requested') as pending_refund_requests
      from public.payments where created_at > now() - interval '30 days'
    """,
    "fraud": """
      select count(*) filter (where status = 'proposed') as open_proposals,
             count(*) filter (where status = 'executed' and updated_at > now() - interval '7 days') as executed_7d,
             (select count(*) from public.wallets where frozen) as frozen_wallets
      from public.ai_actions where agent = 'fraud'
    """,
    "agencies": """
      select a.name, count(h.user_id) as hosts,
             coalesce(sum(g.coins), 0) as gift_coins_7d
      from public.agencies a
      left join public.hosts h on h.agency_id = a.id
      left join lateral (select sum(coins_total) coins from public.gifts where host_id = h.user_id
                         and created_at > now() - interval '7 days') g on true
      group by a.id, a.name order by gift_coins_7d desc limit 10
    """,
    "gifts": """
      select count(*) as gifts_24h, coalesce(sum(coins_total), 0) as coins_24h,
             count(distinct sender_id) as gifters_24h, count(distinct host_id) as hosts_gifted_24h,
             coalesce(sum(owner_share), 0) as owner_coins_24h
      from public.gifts where created_at > now() - interval '24 hours'
    """,
    "wallets": """
      select coalesce(sum(coin_balance), 0) as coins_in_user_wallets,
             (select coalesce(sum(balance), 0) from public.creator_earnings) as creator_earnings_balance,
             (select coalesce(sum(held), 0) from public.creator_earnings) as creator_earnings_held,
             (select count(*) from public.withdrawals where status = 'requested') as pending_withdrawals,
             (select coalesce(sum(coins), 0) from public.withdrawals where status = 'requested') as pending_withdrawal_coins,
             (select value from public.platform_settings where key = 'withdrawal') as withdrawal_config
      from public.wallets
    """,
    "top_hosts": """
      select h.host_code, sum(g.coins_total) as coins_7d
      from public.gifts g join public.hosts h on h.user_id = g.host_id
      where g.created_at > now() - interval '7 days' group by h.host_code order by 2 desc limit 5
    """,
    "streaming": """
      select (select count(*) from public.rooms where status = 'live') as live_now,
             (select coalesce(sum(viewer_count), 0) from public.rooms where status = 'live') as viewers_now,
             count(*) as streams_24h,
             coalesce(round(sum(extract(epoch from (coalesce(ended_at, now()) - started_at))) / 3600.0, 1), 0) as live_hours_24h,
             coalesce(max(peak_viewers), 0) as max_peak_viewers,
             count(*) filter (where ended_at - started_at < interval '5 minutes') as short_streams_24h,
             (select coalesce(round(sum(extract(epoch from (coalesce(v.left_at, now()) - v.joined_at))) / 60.0), 0)
                from public.viewers v where v.joined_at > now() - interval '24 hours') as viewer_minutes_24h
      from public.streams where started_at > now() - interval '24 hours'
    """,
    "safety": """
      select (select count(*) from public.reports where status in ('open', 'reviewing')) as open_reports,
             (select count(*) from public.moderation_actions where created_at > now() - interval '24 hours') as actions_24h,
             (select count(*) from public.messages where status = 'hidden' and created_at > now() - interval '24 hours') as hidden_messages_24h,
             (select count(*) from public.ai_jobs where status = 'failed' and updated_at > now() - interval '24 hours') as failed_ai_jobs_24h
    """,
}

MULTI_ROW = {"revenue", "agencies", "top_hosts"}


class DomainReport(BaseModel):
    status: Literal["green", "amber", "red"]
    headline: str
    highlights: list[str] = Field(description="2-4 notable facts backed by the KPIs")
    risks: list[str] = Field(description="Problems or anomalies, most important first; empty if none")
    recommendations: list[str] = Field(description="Concrete next steps for the owner")


class CeoBriefing(BaseModel):
    headline: str
    summary: str = Field(description="3-5 sentence executive summary")
    priorities: list[str] = Field(description="Top 3 priorities for today, most important first")
    owner_decisions: list[str] = Field(description="Decisions only the owner can make (approvals, policy, money)")


class CeoState(TypedDict, total=False):
    kpis: dict
    domain_reports: Annotated[dict, operator.or_]  # merged from the parallel branches
    briefing: dict
    report_id: int


DOMAINS = {
    "finance_ai": (
        "Finance AI",
        "You are Finance AI for Zynalive. You oversee Agency AI, User AI and Fraud AI: revenue, payers, "
        "refunds, chargebacks, agency performance, user growth and retention, fraud proposals.",
        ["users", "revenue", "payment_risk", "fraud", "agencies"],
    ),
    "economy_ai": (
        "Economy AI",
        "You are Economy AI for Zynalive. You oversee Host AI, Gift AI and Wallet AI: gift volume, the 90/5/5 "
        "split, coin float in wallets, creator earnings liabilities, withdrawals and whether the coin->PKR "
        "withdrawal rate is configured.",
        ["gifts", "wallets", "top_hosts"],
    ),
    "streaming_ai": (
        "Streaming AI",
        "You are Streaming AI for Zynalive. You oversee LiveKit AI, Cost AI and Quality AI: live supply and "
        "demand, live hours, viewer minutes and estimated LiveKit cost "
        f"(assume ${LIVEKIT_USD_PER_PARTICIPANT_MIN}/participant-minute), stream quality signals like very short streams, "
        "and trust & safety load.",
        ["streaming", "safety"],
    ),
}


def build_ceo_graph(db: Database, llm: LLM):
    def collect_kpis(state: CeoState) -> CeoState:
        kpis = {}
        for name, sql in KPI_QUERIES.items():
            kpis[name] = db.all(sql) if name in MULTI_ROW else db.one(sql)
        return {"kpis": kpis, "domain_reports": {}}

    def domain_node(key: str):
        title, system, sections = DOMAINS[key]

        def run(state: CeoState) -> CeoState:
            data = {s: state["kpis"][s] for s in sections}
            report = llm.structured(
                branch="ceo",
                system=system + " Use only the numbers given; say so when data is too thin to judge. Amounts in "
                "*_minor are in the currency's minor unit (paisa for PKR).",
                effort="high",
                schema=DomainReport,
                prompt=f"KPIs (JSON):\n{to_json(data)}\n\nWrite your {title} report for the AI CEO.",
            )
            return {"domain_reports": {key: report.model_dump()}}

        return run

    def ceo_synthesize(state: CeoState) -> CeoState:
        briefing = llm.structured(
            branch="ceo",
            system=(
                "You are the AI CEO of Zynalive, a South-Asia-first live streaming and social platform. You brief the "
                "Owner. Synthesize the three domain reports into a crisp executive briefing. Be direct, prioritise "
                "by business impact and risk, and separate what the Owner must decide from what teams can do."
            ),
            effort="high",
            schema=CeoBriefing,
            prompt=f"Domain reports (JSON):\n{to_json(state['domain_reports'])}",
        )
        return {"briefing": briefing.model_dump()}

    def publish(state: CeoState) -> CeoState:
        b = state["briefing"]
        row = db.one(
            "insert into public.ai_reports (kind, headline, summary, data) values ('ceo_briefing', %s, %s, %s) returning id",
            (b["headline"], b["summary"], Jsonb({"briefing": b, "domains": state["domain_reports"], "kpis": state["kpis"]}, dumps=to_json)),
        )
        db.notify_admins("ceo_briefing", b["headline"], b["summary"], {"report_id": row["id"]})
        return {"report_id": row["id"]}

    g = StateGraph(CeoState)
    g.add_node("collect_kpis", collect_kpis)
    for key in DOMAINS:
        g.add_node(key, domain_node(key))
        g.add_edge("collect_kpis", key)
    g.add_node("ceo_synthesize", ceo_synthesize)
    g.add_node("publish", publish)
    g.add_edge(START, "collect_kpis")
    g.add_edge(list(DOMAINS), "ceo_synthesize")
    g.add_edge("ceo_synthesize", "publish")
    g.add_edge("publish", END)
    return g.compile()
