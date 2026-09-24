"""🤖 Fraud detection branch (also feeds Finance AI).

collect_signals (SQL heuristics) -> assess each suspect with Claude -> propose.
Fraud AI never moves money: it only files ai_actions proposals (freeze wallet,
account review, temp ban) for an owner to approve.
"""

from __future__ import annotations

from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from ..db import Database, to_json
from ..llm import LLM

MAX_SUSPECTS = 20

SIGNALS_SQL = """
with window_gifts as (
  select * from public.gifts where created_at > now() - interval '24 hours'
),
-- A and B gift each other heavily (coin laundering between colluding accounts).
circular as (
  select a.sender_id as user_id, 'circular_gifting' as signal,
         jsonb_build_object('partner', a.host_id, 'sent', sum(a.coins_total)) as detail
  from window_gifts a
  join window_gifts b on b.sender_id = a.host_id and b.host_id = a.sender_id
  group by a.sender_id, a.host_id having sum(a.coins_total) >= 1000
),
-- Nearly all of a user's spend goes to a single host (self-gifting via alt account).
concentrated as (
  select sender_id as user_id, 'single_host_concentration' as signal,
         jsonb_build_object('host', host_id, 'coins', sum(coins_total)) as detail
  from window_gifts group by sender_id, host_id
  having sum(coins_total) >= 2000
     and sum(coins_total) >= 0.95 * (select sum(coins_total) from window_gifts w where w.sender_id = window_gifts.sender_id)
),
-- Brand-new accounts buying a lot.
new_big_buyers as (
  select p.user_id, 'new_account_large_purchase' as signal,
         jsonb_build_object('amount_minor', sum(p.amount_minor), 'currency', min(p.currency)) as detail
  from public.payments p join public.profiles pr on pr.id = p.user_id
  where p.status = 'paid' and p.paid_at > now() - interval '24 hours' and pr.created_at > now() - interval '48 hours'
  group by p.user_id having sum(p.amount_minor) >= 500000
),
-- Repeated disputes/refunds.
disputes as (
  select user_id, 'refunds_or_disputes' as signal, jsonb_build_object('count', count(*)) as detail
  from public.payments where status in ('refunded', 'disputed', 'dispute_lost') and created_at > now() - interval '30 days'
  group by user_id having count(*) >= 2
),
-- Purchase-velocity spikes.
velocity as (
  select user_id, 'purchase_velocity' as signal, jsonb_build_object('purchases_1h', count(*)) as detail
  from public.payments where created_at > now() - interval '1 hour' group by user_id having count(*) >= 5
)
select user_id, jsonb_agg(jsonb_build_object('signal', signal, 'detail', detail)) as signals
from (select * from circular union all select * from concentrated union all select * from new_big_buyers
      union all select * from disputes union all select * from velocity) s
where not exists (select 1 from public.profiles pr where pr.id = s.user_id and pr.role in ('OWNER_ADMIN', 'SUPER_ADMIN'))
group by user_id
order by count(*) desc
limit %s
"""


class FraudAssessment(BaseModel):
    risk: Literal["low", "medium", "high"]
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(description="Concise explanation citing the signals, for the owner")
    recommended_action: Literal["none", "account_review", "freeze_wallet", "temp_ban"]


class FraudState(TypedDict, total=False):
    user_ids: list[str] | None  # None = platform-wide sweep
    suspects: list[dict]
    assessments: list[dict]
    proposals: int


def build_fraud_graph(db: Database, llm: LLM):
    def collect_signals(state: FraudState) -> FraudState:
        rows = db.all(SIGNALS_SQL, (MAX_SUSPECTS,))
        if state.get("user_ids"):
            rows = [r for r in rows if r["user_id"] in state["user_ids"]]
        return {"suspects": rows}

    def assess(state: FraudState) -> FraudState:
        results = []
        for suspect in state["suspects"]:
            profile = db.one(
                """select p.created_at, p.country, p.role, w.coin_balance, w.frozen,
                          (select count(*) from public.payments where user_id = p.id and status = 'paid') as paid_payments,
                          (select count(*) from public.moderation_actions where target_user_id = p.id) as prior_actions
                   from public.profiles p left join public.wallets w on w.user_id = p.id where p.id = %s""",
                (suspect["user_id"],),
            )
            a = llm.structured(
                branch="fraud",
                system=(
                    "You are the fraud analyst for Zynalive's coin and gift economy. Assess whether the account is "
                    "likely abusing payments or gifts (collusion, self-gifting, stolen cards, chargeback abuse). "
                    "Be conservative: false positives hurt honest top gifters. Recommend freeze_wallet only for "
                    "strong evidence of payment fraud, temp_ban only for clear collusion."
                ),
                effort="medium",
                schema=FraudAssessment,
                prompt=f"Signals:\n{to_json(suspect['signals'])}\n\nAccount:\n{to_json(profile)}",
            )
            results.append({"user_id": suspect["user_id"], **a.model_dump()})
        return {"assessments": results}

    def propose(state: FraudState) -> FraudState:
        n = 0
        for a in state["assessments"]:
            if a["risk"] == "low" or a["recommended_action"] == "none":
                continue
            params = {"hours": 72} if a["recommended_action"] == "temp_ban" else {}
            if db.propose_action("fraud", a["recommended_action"], a["user_id"], a["rationale"], a["confidence"], params):
                n += 1
        if n:
            db.notify_admins("ai_proposal", f"Fraud AI filed {n} proposal(s)", "Review them in the Owner command center.")
        return {"proposals": n}

    g = StateGraph(FraudState)
    g.add_node("collect_signals", collect_signals)
    g.add_node("assess", assess)
    g.add_node("propose", propose)
    g.add_edge(START, "collect_signals")
    g.add_conditional_edges("collect_signals", lambda s: "assess" if s["suspects"] else END)
    g.add_edge("assess", "propose")
    g.add_edge("propose", END)
    return g.compile()
