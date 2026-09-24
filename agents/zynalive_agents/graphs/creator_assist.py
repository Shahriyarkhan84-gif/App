"""🤖 Creator assist branch: post-stream summary and coaching for the host."""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..db import Database, to_json
from ..llm import LLM, untrusted


class StreamCoaching(BaseModel):
    headline: str = Field(description="Upbeat one-line recap")
    summary: str = Field(description="2-3 sentences on how the stream went")
    tips: list[str] = Field(description="Exactly 3 specific, actionable tips for the next stream")


class CreatorState(TypedDict, total=False):
    stream_id: str
    stats: dict | None
    chat_sample: list[str]
    coaching: dict


def build_creator_graph(db: Database, llm: LLM):
    def load(state: CreatorState) -> CreatorState:
        stats = db.one(
            """
            select s.id, s.host_id, s.title, s.started_at, s.ended_at, s.peak_viewers, s.gift_coins,
                   extract(epoch from (s.ended_at - s.started_at))::int as duration_s,
                   r.category,
                   (select count(*) from public.messages m where m.stream_id = s.id) as chat_messages,
                   (select count(distinct user_id) from public.viewers v where v.stream_id = s.id) as unique_viewers,
                   (select coalesce(avg(extract(epoch from (coalesce(v.left_at, s.ended_at) - v.joined_at))), 0)::int
                      from public.viewers v where v.stream_id = s.id) as avg_watch_s,
                   (select count(*) from public.follows f where f.followee_id = s.host_id
                      and f.created_at between s.started_at and s.ended_at) as new_followers,
                   (select jsonb_agg(t) from (
                      select g.sender_id, sum(g.coins_total) as coins from public.gifts g
                      where g.stream_id = s.id group by g.sender_id order by 2 desc limit 3) t) as top_gifters,
                   (select jsonb_agg(t) from (
                      select date_trunc('minute', g.created_at) as minute, sum(g.coins_total) as coins
                      from public.gifts g where g.stream_id = s.id group by 1 order by 2 desc limit 1) t) as peak_gift_minute
            from public.streams s join public.rooms r on r.id = s.room_id
            where s.id = %s and s.ended_at is not null
            """,
            (state["stream_id"],),
        )
        chat = []
        if stats:
            chat = [r["body"] for r in db.all(
                "select body from public.messages where stream_id = %s and status = 'visible' order by random() limit 40",
                (state["stream_id"],))]
        return {"stats": stats, "chat_sample": chat}

    def coach(state: CreatorState) -> CreatorState:
        c = llm.structured(
            branch="creator_assist",
            system=(
                "You are a friendly growth coach for live-stream hosts on Zynalive. Base every observation on the "
                "numbers provided; do not invent metrics. Tips should be concrete (timing, interaction, titles, "
                "gift moments, stream length)."
            ),
            effort="medium",
            schema=StreamCoaching,
            prompt=f"Stream stats:\n{to_json(state['stats'])}\n\nChat sample:\n{untrusted(chr(10).join(state['chat_sample']) or '(no chat)')}",
        )
        return {"coaching": c.model_dump()}

    def save(state: CreatorState) -> CreatorState:
        s, c = state["stats"], state["coaching"]
        db.run("update public.streams set ai_summary = %s where id = %s", (Jsonb(c), s["id"]))
        db.notify(s["host_id"], "creator_assist", c["headline"], c["summary"], {"stream_id": str(s["id"])})
        return {}

    g = StateGraph(CreatorState)
    g.add_node("load", load)
    g.add_node("coach", coach)
    g.add_node("save", save)
    g.add_edge(START, "load")
    g.add_conditional_edges("load", lambda s: "coach" if s.get("stats") else END)
    g.add_edge("coach", "save")
    g.add_edge("save", END)
    return g.compile()
