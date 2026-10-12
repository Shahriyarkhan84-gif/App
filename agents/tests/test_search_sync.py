"""Smart search sync: request shapes sent to Pinecone (no network) and the live-room diff (real Postgres)."""

from __future__ import annotations

import json

import httpx

from zynalive_agents.search_sync import NAMESPACE, PineconeIndex, room_text, sync_live_rooms


def test_room_text_is_searchable_by_title_category_host_and_country():
    text = room_text({"title": "Late night gup shup", "category": "chat", "mode": "voice", "display_name": "Hamza Ali",
                      "username": "hamza", "country": "pk"})
    assert text == "Late night gup shup · Chat · voice party · host Hamza Ali · @hamza · Pakistan"
    assert room_text({"title": None, "category": "other", "username": "x", "country": None}) == "Live now · host x · @x"


def test_pinecone_requests_create_index_upsert_ndjson_and_delete():
    calls: list[httpx.Request] = []
    created = {"done": False}

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        if req.method == "GET" and req.url.path == "/indexes/zl":
            if not created["done"]:
                return httpx.Response(404, json={"error": {"code": "NOT_FOUND"}})
            return httpx.Response(200, json={"host": "zl-abc.svc.pinecone.io", "status": {"ready": True, "state": "Ready"}})
        if req.url.path == "/indexes/create-for-model":
            created["done"] = True
            return httpx.Response(201, json={})
        return httpx.Response(200, json={})

    index = PineconeIndex("key", "zl", client=httpx.Client(transport=httpx.MockTransport(handler)))
    index.upsert([{"_id": "r1", "text": "Pakistan vs India · Chat"}, {"_id": "r2", "text": "نعت · Music"}])
    index.delete(["r3"])

    create = next(c for c in calls if c.url.path == "/indexes/create-for-model")
    assert json.loads(create.content) == {"name": "zl", "cloud": "aws", "region": "us-east-1",
                                          "embed": {"model": "multilingual-e5-large", "field_map": {"text": "text"}}}
    up = next(c for c in calls if c.url.path.endswith("/upsert"))
    assert str(up.url) == f"https://zl-abc.svc.pinecone.io/records/namespaces/{NAMESPACE}/upsert"
    assert up.headers["content-type"] == "application/x-ndjson"
    assert up.headers["api-key"] == "key" and up.headers["x-pinecone-api-version"]
    assert [json.loads(line)["_id"] for line in up.content.decode().splitlines()] == ["r1", "r2"]
    assert "نعت" in up.content.decode()  # Urdu stays readable text, not escaped
    rm = next(c for c in calls if c.url.path == "/vectors/delete")
    assert json.loads(rm.content) == {"ids": ["r3"], "namespace": NAMESPACE}


class FakeIndex:
    def __init__(self):
        self.records: dict[str, dict] = {}
        self.upserts = 0

    def upsert(self, records):
        self.upserts += len(records)
        for r in records:
            self.records[r["_id"]] = r

    def delete(self, ids):
        for i in ids:
            self.records.pop(i, None)


def _live_room(db, host: str, title: str) -> str:
    db.run("insert into public.profiles (id, username, display_name, country) values (%s, %s, %s, 'PK')", (host, host, host.title()))
    db.run("insert into public.hosts (user_id) values (%s)", (host,))
    return db.one("insert into public.rooms (host_id, status, title, category) values (%s, 'live', %s, 'chat') returning id::text as id",
                  (host, title))["id"]


def test_sync_adds_live_rooms_resends_only_changes_and_removes_ended(db):
    db.run("truncate private.search_index_state")
    index = FakeIndex()
    a = _live_room(db, "s_host_a", "Cricket talk")
    b = _live_room(db, "s_host_b", "Naat night")

    first = sync_live_rooms(db, index)
    assert (first.upserted, first.deleted, first.live) == (2, 0, 2)
    assert "Cricket talk" in index.records[a]["text"] and index.records[a]["host_id"] == "s_host_a"

    again = sync_live_rooms(db, index)
    assert (again.upserted, again.deleted) == (0, 0)  # nothing changed, nothing re-sent

    db.run("update public.rooms set title = 'Cricket: Pakistan vs India' where id = %s", (a,))
    db.run("update public.rooms set status = 'offline' where id = %s", (b,))
    changed = sync_live_rooms(db, index)
    assert (changed.upserted, changed.deleted, changed.live) == (1, 1, 1)
    assert "Pakistan vs India" in index.records[a]["text"] and b not in index.records

    db.run("update public.profiles set status = 'banned' where id = 's_host_a'")
    gone = sync_live_rooms(db, index)
    assert gone.deleted == 1 and index.records == {}  # banned hosts drop out of search
