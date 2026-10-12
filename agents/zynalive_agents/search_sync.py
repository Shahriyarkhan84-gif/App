"""Smart search: keeps a Pinecone index of the rooms that are live right now.

Pinecone embeds the text itself (integrated embedding, `multilingual-e5-large`, so English, Urdu,
Hindi and Roman Urdu all match by meaning). Every minute the AI worker:
  1. reads the live rooms (title, category, host name, @username, country, party mode),
  2. upserts rooms that are new or whose text changed,
  3. deletes rooms that are no longer live,
remembering what it sent in `private.search_index_state` so unchanged rooms aren't re-sent.
The `smart-search` Edge Function queries the index; the app then loads the rooms itself (RLS).
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from .db import Database

log = logging.getLogger("zynalive.search")

API = "https://api.pinecone.io"
API_VERSION = "2026-07"  # matches @pinecone-database/pinecone 9.x
NAMESPACE = "live"
UPSERT_BATCH = 96  # Pinecone's limit for records with integrated embedding
DELETE_BATCH = 1000

COUNTRY_NAMES = {
    "PK": "Pakistan", "IN": "India", "BD": "Bangladesh", "NP": "Nepal", "LK": "Sri Lanka", "AF": "Afghanistan",
    "AE": "United Arab Emirates", "SA": "Saudi Arabia", "QA": "Qatar", "OM": "Oman", "KW": "Kuwait",
    "GB": "United Kingdom", "US": "United States", "CA": "Canada", "MY": "Malaysia", "TR": "Turkey",
}


class SearchIndex(Protocol):
    def upsert(self, records: list[dict]) -> None: ...
    def delete(self, ids: list[str]) -> None: ...


class PineconeIndex:
    """Minimal Pinecone REST client (create-if-missing, upsert records, delete by id)."""

    def __init__(self, api_key: str, index_name: str, model: str = "multilingual-e5-large", cloud: str = "aws",
                 region: str = "us-east-1", timeout: float = 20.0, client: httpx.Client | None = None):
        self.headers = {"Api-Key": api_key, "X-Pinecone-Api-Version": API_VERSION}
        self.name, self.model, self.cloud, self.region = index_name, model, cloud, region
        self.http = client or httpx.Client(timeout=timeout)
        self._host: str | None = None

    def host(self) -> str:
        if self._host:
            return self._host
        r = self.http.get(f"{API}/indexes/{self.name}", headers=self.headers)
        if r.status_code == 404:
            log.info("creating Pinecone index %s (%s)", self.name, self.model)
            created = self.http.post(f"{API}/indexes/create-for-model", headers=self.headers, json={
                "name": self.name, "cloud": self.cloud, "region": self.region,
                "embed": {"model": self.model, "field_map": {"text": "text"}},
            })
            created.raise_for_status()
            r = self.http.get(f"{API}/indexes/{self.name}", headers=self.headers)
        r.raise_for_status()
        info = r.json()
        if not (info.get("status") or {}).get("ready", False):
            raise RuntimeError("Pinecone index is not ready yet")
        self._host = "https://" + info["host"].removeprefix("https://")
        return self._host

    def upsert(self, records: list[dict]) -> None:
        body = "\n".join(json.dumps(r, ensure_ascii=False) for r in records)
        r = self.http.post(f"{self.host()}/records/namespaces/{NAMESPACE}/upsert", content=body.encode(),
                           headers={**self.headers, "Content-Type": "application/x-ndjson"})
        r.raise_for_status()

    def delete(self, ids: list[str]) -> None:
        r = self.http.post(f"{self.host()}/vectors/delete", headers=self.headers, json={"ids": ids, "namespace": NAMESPACE})
        # Deleting ids Pinecone never had is fine.
        if r.status_code != 404:
            r.raise_for_status()


def room_text(row: dict) -> str:
    """What a room is searchable by; a change here re-embeds every room on the next sync."""
    category = row.get("category") or ""
    parts = [row.get("title") or "Live now", category.capitalize() if category not in ("", "other") else ""]
    if row.get("mode") in ("voice", "video"):
        parts.append(f"{row['mode']} party")
    host = row.get("display_name") or row.get("username")
    if host:
        parts.append(f"host {host}")
    if row.get("username"):
        parts.append(f"@{row['username']}")
    country = (row.get("country") or "").upper()
    if country:
        parts.append(COUNTRY_NAMES.get(country, country))
    return " · ".join(p for p in parts if p)


@dataclass
class SyncResult:
    upserted: int
    deleted: int
    live: int


LIVE_ROOMS_SQL = """
select r.id::text as id, r.title, r.category, r.mode, r.host_id, p.display_name, p.username, p.country
from public.rooms r join public.profiles p on p.id = r.host_id
where r.status = 'live' and p.deleted_at is null and p.status <> 'banned'
"""


def sync_live_rooms(db: Database, index: SearchIndex) -> SyncResult:
    rows = db.all(LIVE_ROOMS_SQL)
    desired = {r["id"]: (r, room_text(r)) for r in rows}
    hashes = {rid: hashlib.sha1(text.encode()).hexdigest() for rid, (_, text) in desired.items()}
    known = {s["room_id"]: s["text_hash"] for s in db.all("select room_id::text as room_id, text_hash from private.search_index_state")}

    to_upsert = [rid for rid in desired if known.get(rid) != hashes[rid]]
    to_delete = [rid for rid in known if rid not in desired]

    for i in range(0, len(to_upsert), UPSERT_BATCH):
        batch = to_upsert[i:i + UPSERT_BATCH]
        index.upsert([{
            "_id": rid, "text": desired[rid][1], "host_id": desired[rid][0]["host_id"],
            "category": desired[rid][0].get("category") or "", "country": (desired[rid][0].get("country") or "").upper(),
        } for rid in batch])
        db.run(
            """insert into private.search_index_state (room_id, text_hash, synced_at)
               select u.room_id::uuid, u.text_hash, now() from unnest(%s::text[], %s::text[]) as u(room_id, text_hash)
               on conflict (room_id) do update set text_hash = excluded.text_hash, synced_at = now()""",
            (batch, [hashes[rid] for rid in batch]),
        )
    for i in range(0, len(to_delete), DELETE_BATCH):
        batch = to_delete[i:i + DELETE_BATCH]
        index.delete(batch)
        db.run("delete from private.search_index_state where room_id = any(%s::uuid[])", (batch,))

    if to_upsert or to_delete:
        log.info("search sync: %s upserted, %s removed, %s live", len(to_upsert), len(to_delete), len(desired))
    return SyncResult(len(to_upsert), len(to_delete), len(desired))
