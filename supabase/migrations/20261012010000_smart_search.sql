-- Smart search (Pinecone): what the AI worker last sent to the search index, so it only re-sends
-- rooms whose searchable text changed and removes rooms that are no longer live. Private: only the
-- worker (database owner connection) reads or writes it. Safe to run more than once.
create table if not exists private.search_index_state (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  text_hash text not null,
  synced_at timestamptz not null default now()
);
revoke all on private.search_index_state from public, anon, authenticated;
