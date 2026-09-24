"""🤖 Translation branch: on-demand chat translation, cached per language."""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel

from ..db import Database
from ..llm import LLM, untrusted


class Translation(BaseModel):
    text: str


class TranslationState(TypedDict, total=False):
    message_id: int
    language: str
    body: str | None
    text: str


def build_translation_graph(db: Database, llm: LLM):
    def load(state: TranslationState) -> TranslationState:
        row = db.one("select body from public.messages where id = %s and status = 'visible'", (state["message_id"],))
        cached = db.one("select 1 from public.message_translations where message_id = %s and language = %s",
                        (state["message_id"], state["language"]))
        return {"body": row["body"] if row and not cached else None}

    def translate(state: TranslationState) -> TranslationState:
        t = llm.structured(
            branch="translation",
            system=("Translate live-chat messages faithfully and naturally, keeping tone, slang and emoji. "
                    "Roman Urdu/Hindi should be understood as such. Output only the translation."),
            effort="low",
            schema=Translation,
            prompt=f"Target language (BCP-47): {state['language']}\nMessage:\n{untrusted(state['body'])}",
        )
        db.run(
            "insert into public.message_translations (message_id, language, body) values (%s, %s, %s) on conflict do nothing",
            (state["message_id"], state["language"], t.text[:1000]),
        )
        return {"text": t.text}

    g = StateGraph(TranslationState)
    g.add_node("load", load)
    g.add_node("translate", translate)
    g.add_edge(START, "load")
    g.add_conditional_edges("load", lambda s: "translate" if s.get("body") else END)
    g.add_edge("translate", END)
    return g.compile()
