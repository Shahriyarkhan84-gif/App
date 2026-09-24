"""🤖 Recommendations branch: ranks live rooms for each recently active user.

Pure SQL scoring (no model call): it runs every few minutes over every
active user, so it must be cheap and deterministic.
Score = follows host (+5) + category affinity (+2) + same country (+2)
      + same language as host (+1) + log(viewers) popularity.
"""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from ..db import Database

SCORE_SQL = """
with active_users as (
  select distinct user_id from (
    select sender_id as user_id from public.messages where created_at > now() - interval '7 days'
    union all select user_id from public.viewers where joined_at > now() - interval '7 days'
    union all select sender_id from public.gifts where created_at > now() - interval '7 days'
  ) a
),
live as (
  select r.id, r.host_id, r.category, r.viewer_count, hp.country, hp.language
  from public.rooms r join public.profiles hp on hp.id = r.host_id where r.status = 'live'
),
affinity as (
  select v.user_id, r.category, count(*) as n
  from public.viewers v join public.streams s on s.id = v.stream_id join public.rooms r on r.id = s.room_id
  where v.joined_at > now() - interval '30 days' group by 1, 2
),
scored as (
  select u.user_id, l.id as room_id,
    (case when f.follower_id is not null then 5 else 0 end)
    + (case when a.n is not null then 2 else 0 end)
    + (case when up.country is not null and up.country = l.country then 2 else 0 end)
    + (case when up.language = l.language then 1 else 0 end)
    + ln(1 + l.viewer_count) as score,
    concat_ws(', ',
      case when f.follower_id is not null then 'you follow this host' end,
      case when a.n is not null then 'you watch ' || l.category end,
      case when up.country = l.country then 'popular near you' end) as reason
  from active_users u
  join public.profiles up on up.id = u.user_id
  cross join live l
  left join public.follows f on f.follower_id = u.user_id and f.followee_id = l.host_id
  left join affinity a on a.user_id = u.user_id and a.category = l.category
  where l.host_id <> u.user_id
),
ranked as (
  select *, row_number() over (partition by user_id order by score desc) as rn from scored
)
insert into public.user_recommendations (user_id, room_id, score, reason, updated_at)
select user_id, room_id, score, nullif(reason, ''), now() from ranked where rn <= 20
on conflict (user_id, room_id) do update set score = excluded.score, reason = excluded.reason, updated_at = now()
"""


class RecsState(TypedDict, total=False):
    written: int


def build_recommendations_graph(db: Database):
    def score(state: RecsState) -> RecsState:
        with db.conn() as c, c.transaction():
            cur = c.execute(SCORE_SQL)
            written = cur.rowcount
            # Drop rooms that went offline or scores from older runs.
            c.execute("""delete from public.user_recommendations ur using public.rooms r
                         where r.id = ur.room_id and (r.status <> 'live' or ur.updated_at < now() - interval '1 hour')""")
        return {"written": written}

    g = StateGraph(RecsState)
    g.add_node("score", score)
    g.add_edge(START, "score")
    g.add_edge("score", END)
    return g.compile()
